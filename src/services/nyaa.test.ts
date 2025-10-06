import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppConfig } from "../config";
import type { DownloadEntry } from "../types";
import { scrapeNyaaSearchResults } from "./nyaa";

// Mock dependencies
vi.mock("../config", () => ({
  getAppConfig: vi.fn(),
}));

vi.mock("cheerio", () => ({
  load: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("nyaa service", () => {
  const mockConfig = {
    nyaaUrl: "https://nyaa.si",
    downloadFolder: "/downloads",
    smtp: {
      host: "smtp.test.com",
      port: 587,
      secure: false,
      user: "test@test.com",
      password: "password"
    },
    reportEmail: "report@test.com",
    fromEmail: "from@test.com"
  };

  const mockDownloadEntry: DownloadEntry = {
    folder: "Test Anime",
    uploader: "TestUploader",
    query: "test anime",
    complete: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppConfig).mockReturnValue(mockConfig);
  });

  describe("scrapeNyaaSearchResults", () => {
    it("should successfully scrape search results", async () => {
      const mockHtml = `
        <div class="table-responsive">
          <tbody>
            <tr>
              <td></td>
              <td>
                <a href="/link1">Category</a>
                <a href="/torrent1">Test Anime S01E01 [1080p]</a>
              </td>
              <td>
                <a href="magnet:?xt=urn:btih:test1">Magnet</a>
              </td>
              <td>1.2 GiB</td>
              <td data-timestamp="1640995200">2022-01-01</td>
            </tr>
            <tr>
              <td></td>
              <td>
                <a href="/link2">Category</a>
                <a href="/torrent2">Test Anime S01E02 [720p]</a>
              </td>
              <td>
                <a href="magnet:?xt=urn:btih:test2">Magnet</a>
              </td>
              <td>800 MiB</td>
              <td data-timestamp="1641081600">2022-01-02</td>
            </tr>
          </tbody>
        </div>
      `;

      const mockResponse = {
        text: vi.fn().mockResolvedValue(mockHtml),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const mockCheerio = {
        map: vi.fn().mockImplementation(() => ({
          get: () => {
            // Mock the callback with our test data for each row
            return [
              {
                title: "Test Anime S01E01 [1080p]",
                magnetLink: "magnet:?xt=urn:btih:test1",
                size: "1.2 GiB",
                timestamp: 1640995200,
              },
              {
                title: "Test Anime S01E02 [720p]",
                magnetLink: "magnet:?xt=urn:btih:test2",
                size: "800 MiB",
                timestamp: 1641081600,
              },
            ];
          },
        })),
      };      const { load } = await import("cheerio");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(load).mockReturnValue((() => mockCheerio) as any);

      const result = await scrapeNyaaSearchResults(mockDownloadEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://nyaa.si/user/TestUploader?f=0&c=1_2&q=test%20anime"
      );
      expect(result).toEqual([
        {
          title: "Test Anime S01E01 [1080p]",
          magnetLink: "magnet:?xt=urn:btih:test1",
          size: "1.2 GiB",
          timestamp: 1640995200,
        },
        {
          title: "Test Anime S01E02 [720p]",
          magnetLink: "magnet:?xt=urn:btih:test2",
          size: "800 MiB",
          timestamp: 1641081600,
        },
      ]);
    });

    it("should handle Anonymous uploader", async () => {
      const anonymousEntry: DownloadEntry = {
        ...mockDownloadEntry,
        uploader: "Anonymous",
      };

      const mockResponse = {
        text: vi.fn().mockResolvedValue("<div></div>"),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const { load } = await import("cheerio");
      vi.mocked(load).mockReturnValue((() => ({
        map: () => ({ get: () => [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any);

      await scrapeNyaaSearchResults(anonymousEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://nyaa.si/?f=0&c=1_2&q=test%20anime"
      );
    });

    it("should handle fetch errors gracefully", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await scrapeNyaaSearchResults(mockDownloadEntry);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error while scraping Nyaa search results:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle malformed HTML gracefully", async () => {
      const mockResponse = {
        text: vi.fn().mockResolvedValue("invalid html"),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const { load } = await import("cheerio");
      vi.mocked(load).mockReturnValue((() => ({
        map: () => ({ get: () => [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any);

      const result = await scrapeNyaaSearchResults(mockDownloadEntry);

      expect(result).toEqual([]);
    });

    it("should properly encode URLs", async () => {
      const specialCharsEntry: DownloadEntry = {
        ...mockDownloadEntry,
        uploader: "User With Spaces",
        query: "anime with special chars & symbols",
      };

      const mockResponse = {
        text: vi.fn().mockResolvedValue("<div></div>"),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const { load } = await import("cheerio");
      vi.mocked(load).mockReturnValue((() => ({
        map: () => ({ get: () => [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any);

      await scrapeNyaaSearchResults(specialCharsEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://nyaa.si/user/User%20With%20Spaces?f=0&c=1_2&q=anime%20with%20special%20chars%20%26%20symbols"
      );
    });
  });
});
