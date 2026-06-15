import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEntry, TrackerData } from "../types";
import { handleSeasonPackDownload } from "./seasonpack";

// Mock dependencies
vi.mock("./nyaa", () => ({
  scrapeNyaaSearchResults: vi.fn(),
}));

vi.mock("./torrent-metadata", () => ({
  getTorrentFileList: vi.fn(),
}));

vi.mock("../utils/logger");
vi.mock("../utils/episode", () => ({
  resolveAnimePattern: vi.fn((entry) => ({ ...entry, resolvedPattern: /S(\d+)E(\d+)/i })),
}));

const mockDownloadEntry: DownloadEntry = {
  folder: "4 Cut Hero",
  uploader: "Anonymous",
  query: "[Gecko] 4 CUT HERO",
  complete: false,
  seasonPack: true,
};

describe("handleSeasonPackDownload", () => {
  let downloadTracker: TrackerData[];

  beforeEach(() => {
    downloadTracker = [];
    vi.clearAllMocks();
  });

  it("returns false if no season packs are found", async () => {
    const { scrapeNyaaSearchResults } = await import("./nyaa");
    vi.mocked(scrapeNyaaSearchResults).mockResolvedValue([]);

    const result = await handleSeasonPackDownload(
      "/downloads/Anime",
      mockDownloadEntry,
      downloadTracker,
    );

    expect(result).toBe(false);
    expect(downloadTracker).toEqual([]);
  });

  it("returns false when the pack contains no video files", async () => {
    const { scrapeNyaaSearchResults } = await import("./nyaa");
    const { getTorrentFileList } = await import("./torrent-metadata");

    vi.mocked(scrapeNyaaSearchResults).mockResolvedValue([
      {
        title: "[Gecko] 4 CUT HERO - S01",
        magnetLink: "magnet:test",
        size: "1GB",
        timestamp: 1234567890,
      },
    ]);
    vi.mocked(getTorrentFileList).mockResolvedValue([
      { name: "README.txt", path: "README.txt" },
    ]);

    const result = await handleSeasonPackDownload(
      "/downloads/Anime",
      mockDownloadEntry,
      downloadTracker,
    );

    expect(result).toBe(false);
    expect(downloadTracker).toEqual([]);
  });
});
