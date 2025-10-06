import * as cliProgress from "cli-progress";
import WebTorrent from "webtorrent";
import { renameFile } from "../utils/file";
import { logger } from "../utils/logger";

export const downloadTorrent = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const torrent = client.add(magnetLink, { path: outputPath });

    const timeout = setTimeout(() => {
      if (!torrent.ready) {
        const error = `Download timed out for ${torrent.name}`;
        torrent.destroy();
        reject(error);
      }
    }, 5000); // 5 seconds timeout

    torrent.on("ready", () => {
      clearTimeout(timeout); // Clear the timeout when torrent is ready
      const bar = multiBar.create(torrent.length, 0);

      torrent.on("download", () => {
        bar.update(torrent.downloaded, { filename: torrent.name });
      });

      torrent.on("done", async () => {
        bar.stop(); // Stop and clear the progress bar
        if (torrent.files.length === 1) {
          const file = torrent.files[0];
          await renameFile(file.path, torrent.name, outputPath);
        }
        resolve();
      });
    });

    torrent.on("error", (error) => {
      clearTimeout(timeout); // Clear the timeout on error
      logger.error("Error downloading torrent:", error);
      reject(error);
    });
  });
};

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};
