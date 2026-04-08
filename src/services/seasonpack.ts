import * as cliProgress from "cli-progress";
import * as fs from "node:fs";
import * as path from "node:path";
import WebTorrent from "webtorrent";
import { DownloadEntry, TrackerData } from "../types";
import { resolveAnimePattern } from "../utils/episode";
import { logger } from "../utils/logger";
import { patterns } from "../utils/patterns";
import { scrapeNyaaSearchResults } from "./nyaa";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Interface for individual file within a season pack torrent
 */
interface SeasonPackFile {
  name: string;
  seasonNumber: string;
  episodeNumber: string;
  isValid: boolean;
}

/**
 * Parse episode information from a filename within a season pack
 * @param filename The filename to parse
 * @param pattern The regex pattern to use, or null to try default patterns
 * @returns Parsed episode information
 */
const parseFileEpisodeInfo = (
  filename: string,
  pattern: RegExp | null,
): SeasonPackFile => {
  // If no pattern provided, try all default patterns
  const patternsToTry = pattern ? [pattern] : patterns.defaultPatterns;

  for (const p of patternsToTry) {
    const match = filename.match(p);
    if (match && match.length === 3) {
      // Handle season extraction (same logic as resolveEpisodeInfo)
      let seasonNumber = 1;
      if (match[1] === "-") {
        seasonNumber = 1;
      } else {
        seasonNumber = parseInt(match[1]) || 1;
      }

      const episodeNumber = match[2];
      const paddedSeasonNumber = seasonNumber.toString().padStart(2, '0');

      return {
        name: filename,
        seasonNumber: paddedSeasonNumber,
        episodeNumber,
        isValid: true,
      };
    }
  }

  // No pattern matched
  return {
    name: filename,
    seasonNumber: '01',
    episodeNumber: "",
    isValid: false,
  };
};

/**
 * Get file list from a torrent by downloading its metadata
 * @param magnetLink The magnet link to inspect
 * @returns Promise resolving to object with file names and paths
 */
const getTorrentFileList = async (
  magnetLink: string,
): Promise<{ name: string; path: string }[]> => {
  return new Promise((resolve, reject) => {
    const client = new WebTorrent();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        client.destroy();
        reject(new Error("Timeout getting torrent metadata"));
      }
    }, 60000); // 1 minute timeout

    try {
      const torrent = client.add(magnetLink, { path: "/tmp" });

      torrent.on("ready", () => {
        resolved = true;
        clearTimeout(timeout);
        const files = torrent.files.map((file) => ({
          name: file.name,
          path: file.path,
        }));
        torrent.destroy();
        client.destroy();
        resolve(files);
      });

      torrent.on("error", (error) => {
        resolved = true;
        clearTimeout(timeout);
        client.destroy();
        reject(error);
      });
    } catch (error) {
      resolved = true;
      clearTimeout(timeout);
      client.destroy();
      reject(error);
    }
  });
};

/**
 * Get all video files recursively from a season folder
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
      // Recursively get files from subdirectories
      const subFiles = getVideoFilesRecursively(itemPath);
      results.push(...subFiles);
    } else if (item.endsWith('.mkv') || item.endsWith('.mp4')) {
      results.push(item);
    }
  }

  return results;
};

/**
 * Check if any episodes from the season pack are missing
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

    // Get all video files recursively from the season folder
    const existingFiles = getVideoFilesRecursively(seasonPath);
    logger.debug(`Found ${existingFiles.length} existing video files in ${seasonFolder}`);

    // Check if this episode exists
    const episodeExists = existingFiles.some((existingFile) => {
      const normalizedFile = existingFile.replace(/\\/g, '/');
      return (
        normalizedFile.includes(`E${file.episodeNumber}`) ||
        normalizedFile.includes(`- ${file.episodeNumber}`) ||
        normalizedFile.includes(`E${file.episodeNumber.padStart(2, '0')}`) ||
        normalizedFile.includes(`- ${file.episodeNumber.padStart(2, '0')}`)
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
 * Download a season pack torrent, selecting only video files to avoid nested folders
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
  videoFiles: { name: string; path: string }[],
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
          }, 120000); // 2 minutes timeout for metadata

          torrent.on("ready", () => {
            if (!torrent) {
              return;
            }

            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }

            // Deselect all files first
            torrent.files.forEach((file) => file.deselect());

            // Select only the video files (this prevents downloading nested folders)
            const videoPaths = new Set(videoFiles.map((f) => f.path));
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

                // Only flatten files if single-season pack
                if (!isMultiSeason && torrent) {
                  // Move files from nested folders to the season folder root
                  for (const file of torrent.files) {
                    // Only process selected video files
                    if (videoPaths.has(file.path)) {
                      const currentPath = path.join(outputPath, file.path);
                      const targetPath = path.join(outputPath, file.name);

                      // If file is in a subfolder, move it to the root
                      if (currentPath !== targetPath && fs.existsSync(currentPath)) {
                        await fs.promises.rename(currentPath, targetPath);
                        logger.debug(`Moved ${file.name} to season folder root`);
                      }
                    }
                  }

                  // Clean up empty subdirectories
                  const items = fs.readdirSync(outputPath);
                  for (const item of items) {
                    const itemPath = path.join(outputPath, item);
                    if (fs.statSync(itemPath).isDirectory()) {
                      try {
                        await fs.promises.rm(itemPath, { recursive: true, force: true });
                        logger.debug(`Removed empty folder: ${item}`);
                      } catch {
                        // Ignore errors (folder might not be empty)
                      }
                    }
                  }
                } else if (isMultiSeason && torrent) {
                  // For multi-season packs, check if there's a common root folder to flatten
                  const items = fs.readdirSync(outputPath);

                  // If there's only one item and it's a directory, it's likely a torrent root folder
                  if (items.length === 1 && fs.statSync(path.join(outputPath, items[0])).isDirectory()) {
                    const rootFolder = items[0];
                    const rootFolderPath = path.join(outputPath, rootFolder);
                    logger.debug(`Detected torrent root folder: ${rootFolder}`);

                    // Move all contents from the root folder up one level
                    const contents = fs.readdirSync(rootFolderPath);
                    for (const item of contents) {
                      const sourcePath = path.join(rootFolderPath, item);
                      const targetPath = path.join(outputPath, item);
                      await fs.promises.rename(sourcePath, targetPath);
                      logger.debug(`Moved ${item} from torrent root to anime folder`);
                    }

                    // Remove the now-empty root folder
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

      return; // Success, exit retry loop
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

/**
 * Handle downloading season pack torrents
 * @param rootFolderPath Root folder for downloads
 * @param anime The download entry (with seasonPack: true)
 * @param downloadTracker Tracker for successful downloads
 * @returns Updated tracker data
 */
export const handleSeasonPackDownload = async (
  rootFolderPath: string,
  anime: DownloadEntry,
  downloadTracker: TrackerData[],
): Promise<TrackerData[]> => {
  logger.info(`${anime.folder} - checking season pack...`);

  try {
    // Scrape Nyaa for season pack torrents
    const available = await scrapeNyaaSearchResults(anime);

    if (available.length === 0) {
      logger.info(`${anime.folder} - no season packs found`);
      return downloadTracker;
    }

    // Get the first (most recent) result
    const seasonPackTorrent = available[0];
    logger.debug(`Found season pack: ${seasonPackTorrent.title}`);

    // Get file list from the torrent
    const files = await getTorrentFileList(seasonPackTorrent.magnetLink);
    logger.debug(`Season pack contains ${files.length} files`);

    // Filter to only video files
    const videoFiles = files.filter(
      (file) => file.name.endsWith('.mkv') || file.name.endsWith('.mp4'),
    );

    if (videoFiles.length === 0) {
      logger.warn(`${anime.folder} - no video files found in season pack`);
      return downloadTracker;
    }

    // Try to resolve pattern from multiple sample files (some might be movies/OVAs)
    let enhancedAnime = { ...anime, resolvedPattern: null as RegExp | null };
    for (const videoFile of videoFiles.slice(0, Math.min(10, videoFiles.length))) {
      enhancedAnime = resolveAnimePattern(anime, videoFile.name);
      if (enhancedAnime.resolvedPattern) {
        logger.debug(`Resolved pattern from: ${videoFile.name}`);
        break;
      }
    }

    // If no pattern found, try to parse all files anyway (some might match default patterns)
    if (!enhancedAnime.resolvedPattern) {
      logger.debug(`${anime.folder} - no custom pattern, trying default patterns`);
      enhancedAnime = { ...anime, resolvedPattern: null };
    }

    // Parse episode info from each file
    const parsedFiles = videoFiles.map((file) =>
      parseFileEpisodeInfo(file.name, enhancedAnime.resolvedPattern),
    );

    const validFiles = parsedFiles.filter((f) => f.isValid);
    logger.debug(`Parsed ${validFiles.length} valid episode files from season pack`);

    // Detect if this is a multi-season pack or has unparseable files (movies/OVAs)
    const uniqueSeasons = new Set(validFiles.map((f) => f.seasonNumber));
    const hasUnparseableFiles = validFiles.length < videoFiles.length;
    const isMultiSeason = uniqueSeasons.size > 1 || hasUnparseableFiles;

    if (isMultiSeason) {
      logger.info(`${anime.folder} - detected multi-season pack (${uniqueSeasons.size} seasons, ${videoFiles.length} total files)`);
    }

    // Check if we're missing any episodes
    const needsDownload = hasMissingEpisodes(validFiles, rootFolderPath, anime.folder);

    if (!needsDownload) {
      logger.info(`${anime.folder} - all episodes already downloaded`);
      return downloadTracker;
    }

    // Determine output path based on multi-season detection
    let outputPath: string;
    if (isMultiSeason) {
      // For multi-season packs, download to anime root and preserve folder structure
      outputPath = `${rootFolderPath}/${anime.folder}`;
      logger.info(`${anime.folder} - downloading multi-season pack with ${validFiles.length} episodes`);
    } else {
      // For single-season packs, download to specific season folder and flatten
      const firstValidFile = validFiles[0];
      const seasonFolder = `Season ${firstValidFile.seasonNumber}`;
      outputPath = `${rootFolderPath}/${anime.folder}/${seasonFolder}`;
      logger.info(`${anime.folder} - downloading season pack with ${validFiles.length} episodes`);
    }

    const client = new WebTorrent();
    const multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: "[{bar}] {filename} | {percentage}% ",
      },
      cliProgress.Presets.shades_classic,
    );

    try {
      await downloadSeasonPackTorrent(
        client,
        multiBar,
        seasonPackTorrent.magnetLink,
        outputPath,
        videoFiles,
        isMultiSeason,
      );

      multiBar.stop();
      client.destroy();

      logger.info(`${anime.folder} - season pack downloaded successfully`);

      // Add to tracker (count all video files for multi-season, only episodes for single)
      const episodeCount = isMultiSeason ? videoFiles.length : validFiles.length;
      downloadTracker.push({
        title: anime.folder,
        newEpisodes: episodeCount,
      });
    } catch (error) {
      multiBar.stop();
      client.destroy();
      throw error;
    }
  } catch (error) {
    logger.error(`Error handling season pack for ${anime.folder}:`, error);
  }

  return downloadTracker;
};
