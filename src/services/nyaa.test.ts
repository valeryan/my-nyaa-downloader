import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppConfig } from "../config";
import type { DownloadEntry } from "../types";
import { scrapeNyaaSearchResults, scrapeNyaaViewPage } from "./nyaa";

// Mock dependencies
vi.mock("../config", () => ({
  getAppConfig: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("nyaa service", () => {
  const mockConfig = {
    nyaaUrl: "https://nyaa.si",
    sukebeiUrl: "https://sukebei.nyaa.si",
    downloadFolder: "/downloads",
    smtp: {
      host: "smtp.test.com",
      port: 587,
      secure: false,
      user: "test@test.com",
      password: "password",
    },
    reportEmail: "report@test.com",
    fromEmail: "from@test.com",
    gemma: {
      apiUrl: "http://127.0.0.1:11434/api/generate",
      model: "gemma4:e4b",
      timeoutMs: 1000,
    },
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
          <table>
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
          </table>
        </div>
      `;

      vi.mocked(fetch).mockResolvedValue({
        text: vi.fn().mockResolvedValue(mockHtml),
      } as unknown as Response);

      const result = await scrapeNyaaSearchResults(mockDownloadEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://nyaa.si/user/TestUploader?f=0&c=1_2&q=test%20anime",
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

      vi.mocked(fetch).mockResolvedValue({
        text: vi.fn().mockResolvedValue("<div></div>"),
      } as unknown as Response);

      await scrapeNyaaSearchResults(anonymousEntry);

      expect(fetch).toHaveBeenCalledWith("https://nyaa.si/?f=0&c=1_2&q=test%20anime");
    });

    it("should handle fetch errors gracefully", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await scrapeNyaaSearchResults(mockDownloadEntry);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error while scraping Nyaa search results:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it("should properly encode URLs", async () => {
      const specialCharsEntry: DownloadEntry = {
        ...mockDownloadEntry,
        uploader: "User With Spaces",
        query: "anime with special chars & symbols",
      };

      vi.mocked(fetch).mockResolvedValue({
        text: vi.fn().mockResolvedValue("<div></div>"),
      } as unknown as Response);

      await scrapeNyaaSearchResults(specialCharsEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://nyaa.si/user/User%20With%20Spaces?f=0&c=1_2&q=anime%20with%20special%20chars%20%26%20symbols",
      );
    });

    it("should allow Sukebei mode for named uploaders", async () => {
      const sukebeiEntry: DownloadEntry = {
        ...mockDownloadEntry,
        uploader: "HentaiHub",
        sukebei: true,
      };

      vi.mocked(fetch).mockResolvedValue({
        text: vi.fn().mockResolvedValue("<div></div>"),
      } as unknown as Response);

      await scrapeNyaaSearchResults(sukebeiEntry);

      expect(fetch).toHaveBeenCalledWith(
        "https://sukebei.nyaa.si/user/HentaiHub?f=0&c=0_0&q=test%20anime",
      );
    });
  });

  describe("scrapeNyaaViewPage", () => {
    it("parses a direct view page", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(`
          <div class="panel-title">Outlaw Star</div>
          <a href="/?c=1_2">Anime</a>
          <a href="/user/sxales">sxales</a>
          <a href="magnet:?xt=urn:btih:test">Magnet</a>
          <div id="torrent-description">Dual audio batch release.</div>
        `),
      } as unknown as Response);

      const result = await scrapeNyaaViewPage("https://nyaa.si/view/1359919");

      expect(result.title).toBe("Outlaw Star");
      expect(result.uploader).toBe("sxales");
      expect(result.sourceSite).toBe("nyaa");
      expect(result.magnetLink).toBe("magnet:?xt=urn:btih:test");
    });

    it("rejects unsupported view URLs", async () => {
      await expect(scrapeNyaaViewPage("https://nyaa.si/?q=test")).rejects.toThrow(
        "Only direct Nyaa or Sukebei /view/<id> links are supported.",
      );
    });
  });
});
