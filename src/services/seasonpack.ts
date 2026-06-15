import * as cliProgress from "cli-progress";
import * as fs from "node:fs";
import * as path from "node:path";
import WebTorrent from "webtorrent";
import type { DownloadEntry, TorrentFileInfo, TrackerData } from "../types";
import { getTorrentFileList } from "./torrent-metadata";
import { resolveAnimePattern } from "../utils/episode";
import { logger } from "../utils/logger";
import { patterns } from "../utils/patterns";
import { scrapeNyaaSearchResults } from "./nyaa";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Interface for individual file within a season pack torrent.
 */
interface SeasonPackFile {
  name: string;
  seasonNumber: string;
  episodeNumber: string;
  isValid: boolean;
}

/**
 * Parse episode information from a filename within a season pack.
 * @param filename The filename to parse
 * @param pattern The regex pattern to use, or null to try default patterns
 * @returns Parsed episode information
 */
const parseFileEpisodeInfo = (
  filename: string,
  pattern: RegExp | null,
): SeasonPackFile => {
  // If no pattern is provided, try all default patterns.
  const patternsToTry = pattern ? [pattern] : patterns.defaultPatterns;

  for (const currentPattern of patternsToTry) {
    const match = filename.match(currentPattern);
    if (match && match.length === 3) {
      // Handle season extraction with the same conventions as episode resolution.
      let seasonNumber = 1;
      if (match[1] === "-") {
        seasonNumber = 1;
      } else {
        seasonNumber = parseInt(match[1]) || 1;
      }

      const episodeNumber = match[2];
      const paddedSeasonNumber = seasonNumber.toString().padStart(2, "0");

      return {
        name: filename,
        seasonNumber: paddedSeasonNumber,
        episodeNumber,
        isValid: true,
      };
    }
  }

  // No pattern matched.
  return {
    name: filename,
    seasonNumber: "01",
    episodeNumber: "",
    isValid: false,
  };
};

/**
 * Get all video files recursively from a season folder.
 * @param seasonPath Path to the season folder
 * @returns Array of video file names (including subfolder paths)
 */
const getVideoFilesRecursively = (seasonPath: string): string[] => {
  if (!fs.existsSync(seasonPath)) {
    return [];
  }

  const results: string[] = [];
  const items = fs.readdirSync(seasonPath);

  for (const item of items) {
    const itemPath = path.join(seasonPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      // Recursively get files from subdirectories.
      const subFiles = getVideoFilesRecursively(itemPath);
      results.push(...subFiles);
    } else if (item.endsWith(".mkv") || item.endsWith(".mp4")) {
      results.push(item);
    }
  }

  return results;
};

/**
 * Check if any episodes from the season pack are missing.
 * @param files Parsed files from the season pack
 * @param rootFolderPath Root download path
 * @param animeFolder Anime folder name
 * @returns True if any episodes are missing
 */
const hasMissingEpisodes = (
  files: SeasonPackFile[],
  rootFolderPath: string,
  animeFolder: string,
): boolean => {
  for (const file of files) {
    if (!file.isValid) continue;

    const seasonFolder = `Season ${file.seasonNumber}`;
    const seasonPath = path.join(rootFolderPath, animeFolder, seasonFolder);

    // Get all video files recursively from the season folder.
    const existingFiles = getVideoFilesRecursively(seasonPath);
    logger.debug(`Found ${existingFiles.length} existing video files in ${seasonFolder}`);

    // Check if this episode already exists.
    const episodeExists = existingFiles.some((existingFile) => {
      const normalizedFile = existingFile.replace(/\\/g, "/");
      return (
        normalizedFile.includes(`E${file.episodeNumber}`) ||
        normalizedFile.includes(`- ${file.episodeNumber}`) ||
        normalizedFile.includes(`E${file.episodeNumber.padStart(2, "0")}`) ||
        normalizedFile.includes(`- ${file.episodeNumber.padStart(2, "0")}`)
      );
    });

    if (!episodeExists) {
      logger.debug(`Missing episode: S${file.seasonNumber}E${file.episodeNumber}`);
      return true;
    }
  }

  logger.debug(`All ${files.length} episodes already exist`);
  return false;
};

/**
 * Download a season pack torrent, selecting only video files to avoid nested folders.
 * @param client WebTorrent client instance
 * @param multiBar Progress bar instance
 * @param magnetLink Magnet link to download
 * @param outputPath Output directory path
 * @param videoFiles Array of video file info from the torrent
 * @param isMultiSeason Whether this is a multi-season pack (preserves folder structure)
 */
const downloadSeasonPackTorrent = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
  videoFiles: TorrentFileInfo[],
  isMultiSeason: boolean = false,
  maxRetries: number = 3,
): Promise<void> => {
  let lastError: Error | string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
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
            torrent.removeAllListeners();
            torrent.destroy();
            torrent = null;
          }
          if (error) {
            reject(error);
          }
        };

        try {
          torrent = client.add(magnetLink, { path: outputPath });

          timeout = setTimeout(() => {
            if (torrent && !torrent.ready) {
              const error = `Torrent metadata timeout for ${torrent.name || "unknown"}`;
              cleanup(error);
            }
          }, 120000);

          torrent.on("ready", () => {
            if (!torrent) {
              return;
            }

            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }

            // Deselect all files first.
            torrent.files.forEach((file) => file.deselect());

            // Select only the video files to avoid downloading nested extras.
            const videoPaths = new Set(videoFiles.map((file) => file.path));
            torrent.files.forEach((file) => {
              if (videoPaths.has(file.path)) {
                file.select();
              }
            });

            bar = multiBar.create(torrent.length, 0);

            torrent.on("download", () => {
              if (bar && torrent) {
                bar.update(torrent.downloaded, { filename: torrent.name });
              }
            });

            torrent.on("done", async () => {
              try {
                if (bar) {
                  bar.stop();
                  bar = null;
                }

                // Only flatten files for single-season packs.
                if (!isMultiSeason && torrent) {
                  for (const file of torrent.files) {
                    // Only process the selected video files.
                    if (videoPaths.has(file.path)) {
                      const currentPath = path.join(outputPath, file.path);
                      const targetPath = path.join(outputPath, file.name);

                      // If the file landed in a subfolder, move it to the season root.
                      if (currentPath !== targetPath && fs.existsSync(currentPath)) {
                        await fs.promises.rename(currentPath, targetPath);
                        logger.debug(`Moved ${file.name} to season folder root`);
                      }
                    }
                  }

                  const items = fs.readdirSync(outputPath);
                  for (const item of items) {
                    const itemPath = path.join(outputPath, item);
                    if (fs.statSync(itemPath).isDirectory()) {
                      try {
                        await fs.promises.rm(itemPath, { recursive: true, force: true });
                        logger.debug(`Removed empty folder: ${item}`);
                      } catch {
                        // Ignore errors for folders that are not empty.
                      }
                    }
                  }
                } else if (isMultiSeason && torrent) {
                  // For multi-season packs, flatten a single torrent root folder if present.
                  const items = fs.readdirSync(outputPath);

                  if (items.length === 1 && fs.statSync(path.join(outputPath, items[0])).isDirectory()) {
                    const rootFolder = items[0];
                    const rootFolderPath = path.join(outputPath, rootFolder);
                    logger.debug(`Detected torrent root folder: ${rootFolder}`);

                    const contents = fs.readdirSync(rootFolderPath);
                    for (const item of contents) {
                      const sourcePath = path.join(rootFolderPath, item);
                      const targetPath = path.join(outputPath, item);
                      await fs.promises.rename(sourcePath, targetPath);
                      logger.debug(`Moved ${item} from torrent root to anime folder`);
                    }

                    await fs.promises.rm(rootFolderPath, { recursive: true, force: true });
                    logger.debug(`Removed torrent root folder: ${rootFolder}`);
                  } else {
                    logger.debug(`Multi-season pack - preserving folder structure (${items.length} items at root)`);
                  }
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

          torrent.on("warning", (warning) => {
            logger.debug("Torrent warning:", warning);
          });
        } catch (error) {
          cleanup(error as Error);
        }
      });
      return;
    } catch (error) {
      lastError = error as Error | string;
      logger.error(`Season pack download attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        await sleep(5000);
      }
    }
  }

  // All retries failed.
  throw lastError ?? new Error("Season pack download failed");
};

/**
 * Handle downloading season pack torrents.
 * @param rootFolderPath Root folder for downloads
 * @param anime The download entry (with seasonPack: true)
 * @param downloadTracker Tracker for successful downloads
 * @returns Whether the season pack was downloaded
 */
export const handleSeasonPackDownload = async (
  rootFolderPath: string,
  anime: DownloadEntry,
  downloadTracker: TrackerData[],
): Promise<boolean> => {
  try {
    // Scrape Nyaa for season pack torrents.
    const available = await scrapeNyaaSearchResults(anime);
    if (available.length === 0) {
      logger.info(`${anime.folder} - no season pack found`);
      return false;
    }

    // Get the first (most recent) result.
    const selectedTorrent = available[0];
    logger.info(`${anime.folder} - checking season pack...`);

    // Get file list from the torrent.
    const torrentFiles = await getTorrentFileList(selectedTorrent.magnetLink);

    // Filter to only video files.
    const videoFiles = torrentFiles.filter(
      (file) => file.name.endsWith(".mkv") || file.name.endsWith(".mp4"),
    );

    if (videoFiles.length === 0) {
      logger.info(`${anime.folder} - no video files found in season pack`);
      return false;
    }

    // Try to resolve a pattern from representative sample files.
    const resolvedPattern = resolveAnimePattern(anime, videoFiles.map((file) => file.name).join("\n")).resolvedPattern;

    // Parse episode info from each file.
    const parsedFiles = videoFiles.map((file) =>
      parseFileEpisodeInfo(file.name, resolvedPattern),
    );

    // Detect if this is a multi-season pack or includes non-episode extras.
    const isMultiSeason =
      new Set(parsedFiles.filter((file) => file.isValid).map((file) => file.seasonNumber)).size > 1 ||
      parsedFiles.some((file) => !file.isValid);

    if (!hasMissingEpisodes(parsedFiles, rootFolderPath, anime.folder)) {
      logger.info(`${anime.folder} - season pack already complete`);
      return false;
    }

    // Determine output path based on multi-season detection.
    const outputPath = isMultiSeason
      ? path.join(rootFolderPath, anime.folder)
      : path.join(rootFolderPath, anime.folder, `Season ${parsedFiles[0]?.seasonNumber || "01"}`);

    fs.mkdirSync(outputPath, { recursive: true });

    logger.info(`${anime.folder} - downloading season pack with ${videoFiles.length} episodes`);

    const client = new WebTorrent();
    const multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: "[{bar}] {filename} | {percentage}% ",
      },
      cliProgress.Presets.shades_classic,
    );

    await downloadSeasonPackTorrent(
      client,
      multiBar,
      selectedTorrent.magnetLink,
      outputPath,
      videoFiles,
      isMultiSeason,
    );

    client.destroy();
    multiBar.stop();

    // Count all video files for multi-season packs, otherwise only parsed episodes.
    const trackedEpisodes = isMultiSeason
      ? videoFiles.length
      : parsedFiles.filter((file) => file.isValid).length;

    downloadTracker.push({
      title: anime.folder,
      newEpisodes: trackedEpisodes,
    });

    return true;
  } catch (error) {
    logger.error(`Error handling season pack download for ${anime.folder}:`, error);
    return false;
  }
};
