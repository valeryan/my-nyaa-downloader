import { describe, expect, it, vi } from "vitest";
import type { DownloadEntry, EntryFileList, TorrentData } from "../types/index";
import {
  filterByHEVC,
  filterByLatestTimestamp,
  filterByResolution,
  filterByVersion,
  filterExistingEpisodes,
  resolveAllEpisodes,
  resolveAnimePattern,
  resolveEpisodeInfo,
  setEpisodePath,
  validatePattern,
} from "./episode";

// Mock the file utilities
vi.mock("./file", () => ({
  checkFolder: vi.fn(),
  getDateModified: vi.fn(() => new Date()),
  removeFile: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    header: vi.fn(),
  },
}));

// Mocks
const mockDownloadEntry: DownloadEntry = {
  folder: "Anime",
  uploader: "TestUploader",
  query: "test anime",
  complete: false,
  pattern: "(S\\d+)E(\\d+)",
};

const mockTorrentData: TorrentData = {
  title: "Anime S01E02 1080p HEVC v2",
  magnetLink: "magnet:test",
  size: "1GB",
  timestamp: 1710000000,
};

const mockTorrentList: TorrentData[] = [
  { title: "Anime S01E01 [720p]", magnetLink: "magnet:test1", size: "800MB", timestamp: 1700000000 },
  { title: "Anime S01E01 [1080p]", magnetLink: "magnet:test2", size: "1GB", timestamp: 1710000000 },
  { title: "Anime S01E01 [1080p] HEVC", magnetLink: "magnet:test3", size: "600MB", timestamp: 1710000001 },
];

const mockFileList: EntryFileList = {
  "Season 1": ["Anime S01E01 720p.mkv", "Anime S01E01 1080p.mkv"],
};

describe("validatePattern", () => {
it("returns RegExp for valid pattern with 2 groups", () => {
  const result = validatePattern("(S\\d+)E(\\d+)");
  expect(result).toBeInstanceOf(RegExp);
});
it("returns false for invalid pattern", () => {
  expect(validatePattern("invalid(")).toBe(false);
  expect(validatePattern("(S\\d+)E")).toBe(false);
  expect(validatePattern(undefined)).toBe(false);
});
});

describe("resolveAnimePattern", () => {
  it("uses custom pattern if valid and matches", () => {
    const entry = { ...mockDownloadEntry, pattern: "(S\\d+)E(\\d+)" };
    const result = resolveAnimePattern(entry, mockTorrentData.title);
    expect(result.resolvedPattern).toBeInstanceOf(RegExp);
  });
  it("falls back to default pattern if custom does not match", () => {
    const entry = { ...mockDownloadEntry, pattern: "(X\\d+)Y(\\d+)" };
    const result = resolveAnimePattern(entry, mockTorrentData.title);
    expect(result.resolvedPattern).toBeInstanceOf(RegExp);
  });
  it("returns null if no pattern matches", () => {
    const entry = { ...mockDownloadEntry, pattern: "(X\\d+)Y(\\d+)" };
    const result = resolveAnimePattern(entry, "no match");
    expect(result.resolvedPattern).toBeNull();
  });
});describe("resolveEpisodeInfo", () => {
it("returns valid episode info when pattern matches", () => {
  const pattern = /(S\d+)E(\d+)/;
  const result = resolveEpisodeInfo(mockTorrentData, pattern);
  expect(result.isValid).toBe(true);
  expect(result.seasonNumber).toBe(1);
  expect(result.episodeNumber).toBe("02");
  expect(result.episodeKey).toBe("S01E02");
});
it("returns invalid when pattern does not match", () => {
  const pattern = /(X\d+)Y(\d+)/;
  const result = resolveEpisodeInfo(mockTorrentData, pattern);
  expect(result.isValid).toBe(false);
});
it("returns invalid when pattern is null", () => {
  const result = resolveEpisodeInfo(mockTorrentData, null);
  expect(result.isValid).toBe(false);
});
});

describe("resolveAllEpisodes", () => {
it("resolves all episodes in list", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01 720p");
  const results = resolveAllEpisodes(anime, mockTorrentList);
  expect(results.length).toBe(mockTorrentList.length);
  expect(results.every((r) => typeof r.isValid === "boolean")).toBe(true);
});
});

describe("setEpisodePath", () => {
it("sets path for valid episode", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, mockTorrentData.title);
  const episode = resolveEpisodeInfo(mockTorrentData, anime.resolvedPattern);
  const result = setEpisodePath("/downloads", anime, episode);
  expect(result.path).toContain("/downloads/Anime/Season 1");
});
it("does not set path for invalid episode", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, "no match");
  const episode = resolveEpisodeInfo(mockTorrentData, anime.resolvedPattern);
  const result = setEpisodePath("/downloads", anime, episode);
  expect(result.path).toBeUndefined();
});
});

describe("filterByResolution", () => {
  it("keeps only highest resolution", () => {
    const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01 [1080p]");
    const testData: TorrentData[] = [
      { title: "Anime S01E01 [720p]", magnetLink: "magnet:test1", size: "800MB", timestamp: 1700000000 },
      { title: "Anime S01E01 [1080p]", magnetLink: "magnet:test2", size: "1GB", timestamp: 1710000000 },
    ];
    const episodes = resolveAllEpisodes(anime, testData);
    const filtered = episodes.filter((ep) => filterByResolution(episodes, ep));
    expect(filtered.some((ep) => ep.title.includes("1080p"))).toBe(true);
    expect(filtered.some((ep) => ep.title.includes("720p"))).toBe(false);
  });
});describe("filterByHEVC", () => {
it("prefers HEVC encoding when available", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01 1080p HEVC");
  const episodes = resolveAllEpisodes(anime, mockTorrentList);
  const filtered = episodes.filter((ep) => filterByHEVC(episodes, ep));
  expect(filtered.some((ep) => ep.title.includes("HEVC"))).toBe(true);
});
});

describe("filterByVersion", () => {
  it("keeps only highest version", () => {
    const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01v2");
    const list: TorrentData[] = [
      { title: "Anime S01E01v1", magnetLink: "magnet:test1", size: "1GB", timestamp: 1710000000 },
      { title: "Anime S01E01v2", magnetLink: "magnet:test2", size: "1GB", timestamp: 1710000001 },
    ];
    const episodes = resolveAllEpisodes(anime, list);
    const filtered = episodes.filter((ep) => filterByVersion(episodes, ep));
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toContain("v2");
  });
});describe("filterByLatestTimestamp", () => {
it("keeps only latest timestamp", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01 1080p");
  const episodes = resolveAllEpisodes(anime, mockTorrentList);
  const filtered = episodes.filter((ep) => filterByLatestTimestamp(episodes, ep));
  expect(filtered.length).toBe(1);
  expect(filtered[0].timestamp).toBe(1710000001);
});
});

describe("filterExistingEpisodes", () => {
it("filters out episodes that exist in fileList", () => {
  const anime = resolveAnimePattern(mockDownloadEntry, "Anime S01E01 1080p");
  const episodes = resolveAllEpisodes(anime, mockTorrentList);
  const filtered = episodes.filter((ep) => filterExistingEpisodes(mockFileList, ep));
  expect(filtered.some((ep) => ep.episodeNumber === "01")).toBe(false);
});
});
