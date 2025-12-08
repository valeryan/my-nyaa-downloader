import * as cliProgress from "cli-progress";
import WebTorrent from "webtorrent";
import { renameFile } from "../utils/file";
import { logger } from "../utils/logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanupTorrent = (torrent: WebTorrent.Torrent, client: WebTorrent.Instance) => {
  try {
    if (torrent && client) {
      torrent.removeAllListeners();
      // Use client.remove instead of torrent.destroy to properly cleanup
      // This prevents "Cannot read properties of null (reading '_debugId')" errors
      client.remove(torrent);
    }
  } catch {
    // Ignore cleanup errors
  }
};

export const downloadTorrent = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
  maxRetries: number = 3,
): Promise<void> => {
  let lastError: Error | string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadTorrentAttempt(client, multiBar, magnetLink, outputPath);
      return; // Success, exit the retry loop
    } catch (error) {
      lastError = error as Error | string;
      logger.warn(
        `Download attempt ${attempt}/${maxRetries} failed: ${
          error instanceof Error ? error.message : error
        }`,
      );

      if (attempt < maxRetries) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.info(`Retrying in ${backoffTime}ms...`);
        await sleep(backoffTime);
      }
    }
  }

  // All retries failed
  throw new Error(
    `Failed to download after ${maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
};

const downloadTorrentAttempt = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    let torrent: WebTorrent.Torrent | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let bar: cliProgress.SingleBar | null = null;

    const cleanup = (error?: Error | string) => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (bar) {
        bar.stop();
        bar = null;
      }
      if (torrent) {
        cleanupTorrent(torrent, client);
        torrent = null;
      }
      if (error) {
        reject(error);
      }
    };

    try {
      torrent = client.add(magnetLink, { path: outputPath });

      // Only timeout if metadata/torrent info can't be retrieved after 2 minutes
      timeout = setTimeout(() => {
        if (torrent && !torrent.ready) {
          const error = `Torrent metadata timeout for ${torrent.name || "unknown"}`;
          cleanup(error);
        }
      }, 120000); // 2 minutes timeout for metadata

      torrent.on("ready", () => {
        if (!torrent) {
          return;
        }

        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }

        bar = multiBar.create(torrent.length, 0, { filename: torrent.name });

        torrent.on("download", () => {
          if (bar && torrent) {
            bar.update(torrent.downloaded, { filename: torrent.name });
          }
        });

        torrent.on("done", async () => {
          try {
            if (!torrent) {
              cleanup("Torrent became null");
              return;
            }

            // Check if any data was actually downloaded
            if (torrent.downloaded === 0 || torrent.length === 0) {
              const error = `Torrent completed with no data: ${torrent.name}`;
              logger.warn(error);
              cleanup(error);
              return;
            }

            if (bar) {
              bar.update(torrent.length, { filename: torrent.name });
              bar.stop();
              bar = null;
            }

            if (torrent.files.length === 1) {
              const file = torrent.files[0];
              await renameFile(file.path, torrent.name, outputPath);
            }

            cleanup();
            resolve();
          } catch (error) {
            cleanup(error as Error);
          }
        });
      });

      torrent.on("error", (error) => {
        logger.error("Torrent error:", error);
        cleanup(error);
      });

      // Tracker warnings are normal and can be ignored in most cases
      torrent.on("warning", (warning) => {
        logger.debug("Torrent warning:", warning);
      });
    } catch (error) {
      cleanup(error as Error);
    }
  });
};

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};
