import * as cliProgress from "cli-progress";
import WebTorrent from "webtorrent";
import { checkFolder, getFileList, removeFile, renameFile } from "./filesystem.ts";
import { logger } from "./logger.ts";
import { scrapeNyaaSearchResults } from "./nyaa.ts";
import { patterns } from "./patterns.ts";
import {
  DownloadEntry,
  EntryFileList,
  EpisodeAttributes,
  TorrentData,
  TrackerData,
} from "./types.ts";

/**
 * Default pattern to match episode numbers.
 * Matches S01E01, S1E1, S01E1, S1E01, etc.
 */
const defaultPattern = patterns.seasonAndEpisode;

/**
 * Map of episodes that need cleanup.
 */
const cleanupEpisodes: Map<string, EpisodeAttributes> = new Map();

/**
 * Flag an episode for cleanup.
 * @param episodeKey The episode key to flag
 * @param seasonKey The season key to flag
 * @param newAttributes The new attributes to set
 */
const flagEpisodesForCleanup = (
  episodeKey: string,
  seasonKey: number,
  newAttributes: Partial<EpisodeAttributes>,
) => {
  const attributes = cleanupEpisodes.get(episodeKey) || {};
  cleanupEpisodes.set(episodeKey, {
    season: seasonKey,
    ...attributes,
    ...newAttributes,
  });
};

/**
 * Validate the given pattern will return 2 groups.
 * @param pattern pattern to validate
 * @returns RegExp object or false if the pattern is invalid
 */
const validatePattern = (pattern: string | undefined): RegExp | false => {
  if (!pattern) {
    return false;
  }
  const regex = new RegExp(pattern);
  const match = regex.source.match(/(?<!\\)\(/g);
  return match && match.length === 4 ? regex : false;
};

/**
 * Download the torrent file for the given magnet link.
 * @param client WebTorrent client
 * @param magnetLink magnet link to the torrent file
 * @param outputPath path to the output directory
 * @returns Promise that resolves when the download is complete
 */
const downloadTorrent = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    client.add(magnetLink, { path: outputPath }, (torrent) => {
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

      torrent.on("error", (error) => {
        bar.stop(); // Stop and clear the progress bar
        logger.error("Error downloading torrent:", error);
        reject(error);
      });
    });
  });
};

/**
 * Get the episode key from the title.
 * @param anime The DownloadEntry
 * @param title The title to match
 * @returns episode key or null if not found
 */
const getEpisodeKey = (anime: DownloadEntry, title: string) => {
  const pattern = validatePattern(anime.pattern) || defaultPattern;
  const match = title.match(pattern);
  return match && match.length === 3 ? match[0] : null;
};

/**
 * Get the season key from the title.
 * @param anime The DownloadEntry
 * @param title The title to match
 * @returns season key
 */
const getSeasonKey = (anime: DownloadEntry, title: string) => {
  const pattern = validatePattern(anime.pattern) || defaultPattern;
  const match = title.match(pattern);
  return match && match.length === 3 ? parseInt(match[1]) || 1 : 1;
};

/**
 * Get duplicate episodes based on the episode key.
 * @param available Possible download results
 * @param anime The DownloadEntry
 * @param episodeKey The episode key to match
 * @returns List of duplicate episodes
 */
const getDuplicateEpisodes = (
  available: TorrentData[],
  anime: DownloadEntry,
  episodeKey: string,
) => {
  const pattern = validatePattern(anime.pattern) || defaultPattern;
  return available.filter((result) => {
    const match = result.title.match(pattern);
    return match && match.length === 3 && match[0] === episodeKey;
  });
};

/**
 * Remove duplicate episodes that are versioned, keep highest version.
 * @param available Full list of results
 * @param anime The DownloadEntry
 * @param episode The item to check
 * @returns boolean
 */
const versionedEpisodes = (
  available: TorrentData[],
  anime: DownloadEntry,
  episode: TorrentData,
) => {
  // Can't determine episode key, remove item
  const episodeKey = getEpisodeKey(anime, episode.title);
  if (episodeKey === null) {
    return false;
  }

  const seasonKey = getSeasonKey(anime, episode.title);

  // Only one result, keep it
  const duplicateEpisodes = getDuplicateEpisodes(available, anime, episodeKey);
  if (duplicateEpisodes.length <= 1) {
    return true;
  }

  // Get the highest version number
  const versionedPattern = patterns.versioned(episodeKey);
  const highestVersion = duplicateEpisodes.reduce((maxVersion, result) => {
    const versionMatch = result.title.match(versionedPattern);
    const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;
    return Math.max(maxVersion, version);
  }, 1);

  flagEpisodesForCleanup(episodeKey, seasonKey, { version: highestVersion });

  // only keep the highest version
  const versionMatch = episode.title.match(versionedPattern);
  const version = versionMatch ? parseInt(versionMatch[1]) : 1;
  return version === highestVersion;
};

/**
 * Remove duplicate episodes that different resolutions, keep highest resolution.
 * @param available Full list of results
 * @param anime The DownloadEntry
 * @param episode The item to check
 * @returns boolean
 */
const resolutionedEpisodes = (
  available: TorrentData[],
  anime: DownloadEntry,
  episode: TorrentData,
) => {
  // Can't determine episode key, remove item
  const episodeKey = getEpisodeKey(anime, episode.title);
  if (episodeKey === null) {
    return false;
  }

  const seasonKey = getSeasonKey(anime, episode.title);

  // Only one result, keep it
  const duplicateEpisodes = getDuplicateEpisodes(available, anime, episodeKey);
  if (duplicateEpisodes.length <= 1) {
    return true;
  }
  // Get the highest resolution
  const resolutionPattern = patterns.resolution;
  const highestResolution = duplicateEpisodes.reduce(
    (maxResolution, result) => {
      const resolutionMatch = result.title.match(resolutionPattern);
      const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 1080;
      return Math.max(maxResolution, resolution);
    },
    1080,
  );

  flagEpisodesForCleanup(episodeKey, seasonKey, {
    resolution: highestResolution,
  });

  // Only keep the highest resolution
  const resolutionMatch = episode.title.match(resolutionPattern);
  const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 1080;
  return resolution === highestResolution;
};

/**
 * Remove duplicate episodes that are not HEVC, keep HEVC if exists.
 * @param available Full list of results
 * @param anime The DownloadEntry
 * @param episode The item to check
 * @returns boolean
 */
const hevcEpisodes = (
  available: TorrentData[],
  anime: DownloadEntry,
  episode: TorrentData,
) => {
  // Can't determine episode key, remove item
  const episodeKey = getEpisodeKey(anime, episode.title);
  if (episodeKey === null) {
    return false;
  }

  const seasonKey = getSeasonKey(anime, episode.title);

  // Only one result, keep it
  const duplicateEpisodes = getDuplicateEpisodes(available, anime, episodeKey);
  if (duplicateEpisodes.length <= 1) {
    return true;
  }
  // Check if any result is HEVC
  const hasHEVC = duplicateEpisodes.some((result) =>
    result.title.includes("[HEVC]"),
  );
  if (!hasHEVC) {
    return true;
  }
  flagEpisodesForCleanup(episodeKey, seasonKey, { encoding: "HEVC" });
  return episode.title.includes("[HEVC]");
};

const episodeCleanupHandler = (
  rootFolderPath: string,
  fileList: EntryFileList,
  anime: DownloadEntry,
) => {
  cleanupEpisodes.forEach((attributes, episodeKey) => {
    const seasonFolder = `Season ${attributes.season}`;
    const episodePath = `${rootFolderPath}/${anime.folder}/${seasonFolder}`;
    const matchingFiles = fileList[seasonFolder].filter((file) =>
      file.includes(episodeKey),
    );
    matchingFiles.forEach((file) => {
      // Handle versioned episodes
      if (attributes.version) {
        const version = `v${attributes.version}`;
        if (!file.includes(version)) {
          logger.info(`Removing old version: ${file}`);
          removeFile(`${episodePath}/${file}`);
        }
      }

      // Handle resolutioned episodes
      if (attributes.resolution) {
        const resolution = `${attributes.resolution}p`;
        if (!file.includes(resolution)) {
          logger.info(`Removing old resolution: ${file}`);
          removeFile(`${episodePath}/${file}`);
        }
      }

      // Handle HEVC episodes
      if (attributes.encoding) {
        if (!file.includes(attributes.encoding)) {
          logger.info(`Removing old encoding: ${file}`);
          removeFile(`${episodePath}/${file}`);
        }
      }
    });
  });
  cleanupEpisodes.clear();
};

/**
 * Remove existing episodes from the results.
 * @param fileList List of files in the destination folder
 * @param anime The DownloadEntry
 * @param episode The item to check
 * @returns boolean
 */
const existingEpisodes = (
  fileList: EntryFileList,
  anime: DownloadEntry,
  episode: TorrentData,
) => {
  const pattern = validatePattern(anime.pattern) || defaultPattern;
  const match = episode.title.match(pattern);
  // Remove entries that do not match the expected pattern
  if (!match || match.length != 3) {
    return false;
  }

  // we can assume a missing season folder means no episodes exist
  const seasonFolder = `Season ${parseInt(match[1]) || 1}`;
  if (!fileList[seasonFolder]) {
    return true;
  }

  const episodeNumber = match[2].toString();

  return !fileList[seasonFolder].some((file) => {
    const fileMatch = file.match(pattern);
    return fileMatch && fileMatch[2].toString() === episodeNumber;
  });
};

/**
 * Set the path for the episode.
 * @param rootFolderPath the root folder path
 * @param anime The DownloadEntry
 * @param episode The item to check
 * @returns TorrentData with path set
 */
const setEpisodePath = (
  rootFolderPath: string,
  anime: DownloadEntry,
  episode: TorrentData,
) => {
  const pattern = validatePattern(anime.pattern) || defaultPattern;
  const match = episode.title.match(pattern);
  if (match && match.length == 3) {
    const seasonNumber = parseInt(match[1]) || 1;
    const seasonFolder = `Season ${seasonNumber}`;
    episode.path = `${rootFolderPath}/${anime.folder}/${seasonFolder}`;
    checkFolder(episode.path);
  }
  return episode;
};

export const handleDownloadingNewEpisodes = async (
  rootFolderPath: string,
  downloads: DownloadEntry[],
  downloadTracker: TrackerData[],
): Promise<TrackerData[]> => {
  logger.header(`Checking ${rootFolderPath} for new episodes...`);
  // Iterate through each metadata entry
  for (const anime of downloads) {
    // Skip completed entries
    if (anime.complete) {
      logger.info(`${anime.folder} - already complete.`);
      continue;
    }
    // Create workers
    let client: WebTorrent.Instance | null = null;
    let multiBar: cliProgress.MultiBar | null = null;

    try {
      // Scrape Nyaa search results
      const available = await scrapeNyaaSearchResults(anime);
      const fileList = getFileList(rootFolderPath, anime);

      // Apply special filters
      let specialFilters = available.filter((episode) =>
        resolutionedEpisodes(available, anime, episode),
      );
      specialFilters = specialFilters.filter((episode) =>
        hevcEpisodes(specialFilters, anime, episode),
      );
      specialFilters = specialFilters.filter((episode) =>
        versionedEpisodes(specialFilters, anime, episode),
      );

      // Cleanup special episodes
      episodeCleanupHandler(rootFolderPath, fileList, anime);

      // Filter out existing episodes and update the path
      const filteredResults = specialFilters
        .filter((episode) => existingEpisodes(fileList, anime, episode))
        .map((episode) => setEpisodePath(rootFolderPath, anime, episode));

      const newEpisodes = filteredResults.length;
      logger.info(`${anime.folder} - new episodes: ${newEpisodes}`);

      if (newEpisodes > 0) {
        client = new WebTorrent();
        multiBar = new cliProgress.MultiBar(
          {
            clearOnComplete: false,
            hideCursor: true,
            format: "[{bar}] {filename} | {percentage}% ",
          },
          cliProgress.Presets.shades_classic,
        );

        // Download torrents for this query
        await Promise.all(
          filteredResults.map(({ magnetLink, path }) => {
            if (magnetLink && path) {
              return downloadTorrent(client!, multiBar!, magnetLink, path);
            }
            return Promise.resolve();
          }),
        );

        // Tear down the progress bar and WebTorrent client
        multiBar.stop();
        multiBar = null;
        client.destroy();
        client = null;

        // Add the series and new episode count to the download tracker
        downloadTracker.push({
          title: anime.folder,
          newEpisodes: newEpisodes,
        });
      }
    } catch (error) {
      logger.error(
        `Error building URL or handling episodes for ${anime.folder}:`,
        error,
      );

      if (multiBar) {
        multiBar.stop();
      }

      if (client) {
        client.destroy();
      }
    }
  }
  const totalNewEpisodes = downloadTracker.reduce(
    (total, item) => total + item.newEpisodes,
    0,
  );
  logger.header(`${totalNewEpisodes} Episodes Downloaded`);

  return downloadTracker;
};
