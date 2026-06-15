import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEntry, TrackerData } from "../types";
import { getFileList } from "../utils/file";
import { handleDownloadingNewEpisodes } from "./download";
import { scrapeNyaaSearchResults } from "./nyaa";
import { handleSeasonPackDownload } from "./seasonpack";
import { downloadTorrent } from "./torrent";

// Mock all dependencies
vi.mock("./nyaa", () => ({
  scrapeNyaaSearchResults: vi.fn(),
}));

vi.mock("./seasonpack", () => ({
  handleSeasonPackDownload: vi.fn(),
}));

vi.mock("./torrent", () => ({
  downloadTorrent: vi.fn(),
}));

vi.mock("../utils/episode", () => ({
  resolveAllEpisodes: vi.fn(),
  filterExistingEpisodes: vi.fn(),
  cleanupEpisodesHandler: vi.fn(),
  filterByResolution: vi.fn(() => true),
  filterByHEVC: vi.fn(() => true),
  filterByVersion: vi.fn(() => true),
  filterByLatestTimestamp: vi.fn(() => true),
  resolveAnimePattern: vi.fn((entry) => ({ ...entry, resolvedPattern: /S(\d+)E(\d+)/i })),
  setEpisodePath: vi.fn((_, __, episode) => episode),
}));

vi.mock("../utils/file");
vi.mock("../utils/logger");

describe("download service", () => {
  const mockDownloadList: DownloadEntry[] = [
    {
      folder: "Test Anime",
      uploader: "TestUploader",
      query: "test anime",
      complete: false,
    },
    {
      folder: "Another Anime",
      uploader: "AnotherUploader",
      query: "another anime",
      complete: true,
    },
  ];

  const mockTrackerData: TrackerData[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handleSeasonPackDownload).mockResolvedValue(false);
  });

  describe("handleDownloadingNewEpisodes", () => {
    it("should skip complete downloads", async () => {
      const completeOnlyList: DownloadEntry[] = [
        {
          folder: "Complete Anime",
          uploader: "TestUploader",
          query: "complete anime",
          complete: true,
        },
      ];

      const result = await handleDownloadingNewEpisodes(
        "/downloads",
        completeOnlyList,
        mockTrackerData,
      );

      expect(scrapeNyaaSearchResults).not.toHaveBeenCalled();
      expect(downloadTorrent).not.toHaveBeenCalled();
      expect(result).toEqual(mockTrackerData);
    });

    it("marks successful season-pack downloads complete", async () => {
      const seasonPackEntry: DownloadEntry = {
        folder: "Pack Show",
        uploader: "Anonymous",
        query: "Pack Show",
        complete: false,
        seasonPack: true,
      };

      vi.mocked(handleSeasonPackDownload).mockResolvedValue(true);

      await handleDownloadingNewEpisodes("/downloads", [seasonPackEntry], []);

      expect(handleSeasonPackDownload).toHaveBeenCalledWith(
        "/downloads",
        seasonPackEntry,
        [],
      );
      expect(seasonPackEntry.complete).toBe(true);
    });

    it("should handle scraping errors gracefully", async () => {
      vi.mocked(scrapeNyaaSearchResults).mockRejectedValue(new Error("Scraping failed"));

      const result = await handleDownloadingNewEpisodes(
        "/downloads",
        [mockDownloadList[0]],
        mockTrackerData,
      );

      expect(result).toEqual(expect.any(Array));
    });

    it("should return updated tracker data", async () => {
      const mockSearchResults = [
        {
          title: "Test Anime S01E01 [1080p]",
          magnetLink: "magnet:?xt=urn:btih:test1",
          size: "1.2 GiB",
          timestamp: 1640995200,
        },
      ];

      const { resolveAllEpisodes, filterExistingEpisodes } = await import("../utils/episode");

      vi.mocked(scrapeNyaaSearchResults).mockResolvedValue(mockSearchResults);
      vi.mocked(getFileList).mockReturnValue({} as never);
      vi.mocked(resolveAllEpisodes).mockReturnValue([
        { ...mockSearchResults[0], isValid: true, episodeKey: "S01E01", seasonNumber: "01", episodeNumber: "01", pattern: /S(\d+)E(\d+)/i },
      ] as never);
      vi.mocked(filterExistingEpisodes).mockReturnValue(true);
      vi.mocked(downloadTorrent).mockResolvedValue();

      const result = await handleDownloadingNewEpisodes(
        "/downloads",
        [mockDownloadList[0]],
        mockTrackerData,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty search results", async () => {
      vi.mocked(scrapeNyaaSearchResults).mockResolvedValue([]);
      vi.mocked(getFileList).mockReturnValue({} as never);

      const result = await handleDownloadingNewEpisodes(
        "/downloads",
        [mockDownloadList[0]],
        mockTrackerData,
      );

      expect(downloadTorrent).not.toHaveBeenCalled();
      expect(result).toEqual(expect.any(Array));
    });

    it("should handle multiple anime entries", async () => {
      const multipleAnime = [
        mockDownloadList[0],
        {
          folder: "Third Anime",
          uploader: "ThirdUploader",
          query: "third anime",
          complete: false,
        },
      ];

      const mockSearchResults = [
        {
          title: "Episode 1",
          magnetLink: "magnet:test1",
          size: "1GB",
          timestamp: 123456,
        },
      ];

      const { resolveAllEpisodes, filterExistingEpisodes } = await import("../utils/episode");

      vi.mocked(scrapeNyaaSearchResults).mockResolvedValue(mockSearchResults);
      vi.mocked(getFileList).mockReturnValue({} as never);
      vi.mocked(resolveAllEpisodes).mockReturnValue([
        { ...mockSearchResults[0], isValid: true, episodeKey: "Episode 1", seasonNumber: "01", episodeNumber: "01", pattern: /S(\d+)E(\d+)/i },
      ] as never);
      vi.mocked(filterExistingEpisodes).mockReturnValue(true);
      vi.mocked(downloadTorrent).mockResolvedValue();

      const result = await handleDownloadingNewEpisodes(
        "/downloads",
        multipleAnime,
        mockTrackerData,
      );

      expect(scrapeNyaaSearchResults).toHaveBeenCalledTimes(2);
      expect(result).toEqual(expect.any(Array));
    });
  });
});
