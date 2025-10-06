import { beforeEach, describe, expect, it, vi } from "vitest";
import { renameFile } from "../utils/file";
import { logger } from "../utils/logger";
import { chunkArray, downloadTorrent } from "./torrent";

// Mock dependencies
vi.mock("../utils/file", () => ({
  renameFile: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("torrent service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("chunkArray", () => {
    it("should split array into chunks of specified size", () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const result = chunkArray(array, 3);

      expect(result).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ]);
    });

    it("should handle arrays that don't divide evenly", () => {
      const array = [1, 2, 3, 4, 5];
      const result = chunkArray(array, 2);

      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5]
      ]);
    });

    it("should handle empty arrays", () => {
      const result = chunkArray([], 3);
      expect(result).toEqual([]);
    });

    it("should handle chunk size larger than array", () => {
      const array = [1, 2];
      const result = chunkArray(array, 5);
      expect(result).toEqual([[1, 2]]);
    });
  });

  describe("downloadTorrent", () => {
    interface MockBar {
      update: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }

    interface MockMultiBar {
      create: ReturnType<typeof vi.fn>;
    }

    interface MockTorrent {
      ready: boolean;
      length: number;
      downloaded: number;
      name: string;
      files: Array<{ path: string }>;
      on: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    }

    interface MockClient {
      add: ReturnType<typeof vi.fn>;
    }

    let mockClient: MockClient;
    let mockMultiBar: MockMultiBar;
    let mockTorrent: MockTorrent;
    let mockBar: MockBar;

    beforeEach(() => {
      mockBar = {
        update: vi.fn(),
        stop: vi.fn(),
      };

      mockMultiBar = {
        create: vi.fn().mockReturnValue(mockBar),
      };

      mockTorrent = {
        ready: false,
        length: 1000,
        downloaded: 500,
        name: "test-torrent.mkv",
        files: [{ path: "/test/path.mkv" }],
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockClient = {
        add: vi.fn().mockReturnValue(mockTorrent),
      };
    });

    it("should successfully download a torrent", async () => {
      // Setup torrent events to simulate successful download
      mockTorrent.on.mockImplementation((event: string, callback: () => void) => {
        if (event === "ready") {
          mockTorrent.ready = true;
          setTimeout(() => callback(), 0);
        } else if (event === "done") {
          setTimeout(() => callback(), 10);
        }
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const promise = downloadTorrent(
        mockClient as any,
        mockMultiBar as any,
        "magnet:test",
        "/output/path"
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      await promise;

      expect(mockClient.add).toHaveBeenCalledWith("magnet:test", { path: "/output/path" });
      expect(mockMultiBar.create).toHaveBeenCalledWith(1000, 0);
      expect(mockBar.stop).toHaveBeenCalled();
      expect(renameFile).toHaveBeenCalledWith("/test/path.mkv", "test-torrent.mkv", "/output/path");
    });

    it("should handle torrent errors", async () => {
      const testError = new Error("Torrent error");

      mockTorrent.on.mockImplementation((event: string, callback: (error?: Error) => void) => {
        if (event === "error") {
          setTimeout(() => callback(testError), 0);
        }
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const promise = downloadTorrent(
        mockClient as any,
        mockMultiBar as any,
        "magnet:test",
        "/output/path"
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      await expect(promise).rejects.toBe(testError);
      expect(logger.error).toHaveBeenCalledWith("Error downloading torrent:", testError);
    });

    it("should update progress during download", async () => {
      let downloadCallback: (() => void) | undefined;

      mockTorrent.on.mockImplementation((event: string, callback: () => void) => {
        if (event === "ready") {
          mockTorrent.ready = true;
          setTimeout(() => callback(), 0);
        } else if (event === "download") {
          downloadCallback = callback;
        } else if (event === "done") {
          setTimeout(() => callback(), 20);
        }
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const promise = downloadTorrent(
        mockClient as any,
        mockMultiBar as any,
        "magnet:test",
        "/output/path"
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // Simulate download progress
      setTimeout(() => {
        mockTorrent.downloaded = 750;
        downloadCallback?.();
      }, 5);

      await promise;

      expect(mockBar.update).toHaveBeenCalledWith(750, { filename: "test-torrent.mkv" });
    });

    it("should not rename file if multiple files in torrent", async () => {
      mockTorrent.files = [
        { path: "/test/path1.mkv" },
        { path: "/test/path2.mkv" }
      ];

      mockTorrent.on.mockImplementation((event: string, callback: () => void) => {
        if (event === "ready") {
          mockTorrent.ready = true;
          setTimeout(() => callback(), 0);
        } else if (event === "done") {
          setTimeout(() => callback(), 10);
        }
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      await downloadTorrent(
        mockClient as any,
        mockMultiBar as any,
        "magnet:test",
        "/output/path"
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      expect(renameFile).not.toHaveBeenCalled();
    });
  });
});
