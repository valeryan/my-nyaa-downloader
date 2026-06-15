import WebTorrent from "webtorrent";
import type { TorrentFileInfo } from "../types";

/**
 * Get file list from a torrent by downloading its metadata.
 * @param magnetLink The magnet link to inspect
 * @returns Promise resolving to object with file names and paths
 */
const inspectTorrentMetadata = async (magnetLink: string): Promise<TorrentFileInfo[]> => {
  if (!magnetLink) {
    return [];
  }

  return new Promise((resolve, reject) => {
    const client = new WebTorrent();
    let settled = false;

    const cleanup = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      client.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve([]);
    };

    const timeout = setTimeout(() => {
      cleanup(new Error("Timed out while inspecting torrent metadata."));
    }, 60000);

    try {
      const torrent = client.add(magnetLink, { path: "/tmp" });
      torrent.on("ready", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const files = torrent.files.map((file) => ({
          name: file.name,
          path: file.path || file.name,
        }));
        torrent.destroy();
        client.destroy();
        resolve(files);
      });
      torrent.on("error", (error) => {
        clearTimeout(timeout);
        cleanup(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      clearTimeout(timeout);
      cleanup(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

export const getTorrentFileList = async (magnetLink: string): Promise<TorrentFileInfo[]> =>
  inspectTorrentMetadata(magnetLink);

export const inspectTorrentFiles = async (magnetLink: string): Promise<string[]> => {
  const files = await inspectTorrentMetadata(magnetLink);
  return files.map((file) => file.path || file.name);
};
