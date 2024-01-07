import * as cliProgress from "cli-progress";
import WebTorrent from "webtorrent";
import { checkFolder, getFileList, removeFile } from "./filesystem.ts";
import { logger } from "./logger.ts";
import { scrapeNyaaSearchResults } from "./nyaa.ts";
import {
  DownloadEntry,
  EntryFileList,
  TorrentData,
  TrackerData,
} from "./types.ts";

/**
 * Default pattern to match episode numbers.
 */
const defaultPattern = /S(\d+)E(\d+)/i;

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
  return match && match.length === 2 ? regex : false;
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

      torrent.on("done", () => {
        bar.stop(); // Stop and clear the progress bar
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
 * Remove duplicate episodes that are versioned, keep highest version.
 * @param results Full list of results
 * @param entry The DownloadEntry
 * @param item The item to check
 * @returns boolean
 */
const versionedEpisodes = (
  results: TorrentData[],
  entry: DownloadEntry,
  item: TorrentData,
) => {
  const pattern = validatePattern(entry.pattern) || defaultPattern;
  const match = item.title.match(pattern);
  if (match && match.length == 3) {
    const episodeKey = match[0];
    const versionedPattern = new RegExp(`${episodeKey}v(\\d+)`, "i");
    // Find all results with the same episodeKey
    const sameEpisodeResults = results.filter((result) => {
      const match = result.title.match(pattern);
      return match && match.length == 3 && match[0] === episodeKey;
    });
    // If there's only one result with the same episodeKey, no need to check for versions
    if (sameEpisodeResults.length <= 1) {
      return true;
    }
    // Find the highest version among the sameEpisodeResults
    const highestVersion = sameEpisodeResults.reduce((maxVersion, result) => {
      const versionMatch = result.title.match(versionedPattern);
      const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;
      return Math.max(maxVersion, version);
    }, 1);

    // Check if the version of the current result is the highest
    const versionMatch = item.title.match(versionedPattern);
    const version = versionMatch ? parseInt(versionMatch[1]) : 1;

    return version === highestVersion;
  }

  return false;
};

/**
 * Remove existing episodes from the results.
 * @param rootFolderPath the root folder path
 * @param fileList List of files in the destination folder
 * @param entry The DownloadEntry
 * @param item The item to check
 * @returns boolean
 */
const existingEpisodes = (
  rootFolderPath: string,
  fileList: EntryFileList,
  entry: DownloadEntry,
  item: TorrentData,
) => {
  const pattern = validatePattern(entry.pattern) || defaultPattern;
  const match = item.title.match(pattern);
  if (match && match.length == 3) {
    const seasonNumber = parseInt(match[1], 10);
    const seasonFolder = `Season ${seasonNumber}`;

    const episodePath = `${rootFolderPath}/${entry.folder}/${seasonFolder}`;
    const episodeNumber = match[2].toString();
    const episodeFile = `- ${episodeNumber}`;

    const episodeKey = match[0];
    const versionedPattern = new RegExp(`${episodeKey}v(\\d+)`, "i");
    const versionMatch = item.title.match(versionedPattern);

    if (fileList[seasonFolder]) {
      // Special handling for versioned episodes
      // if item has a version
      if (versionMatch) {
        const version = parseInt(versionMatch[1]);
        // Check if fileList has an entry that matches the episode
        const fileKey = fileList[seasonFolder].find((file) =>
          file.includes(episodeKey),
        );
        if (fileKey) {
          // Check if the file has a version
          const fileVersionMatch = fileKey.match(versionedPattern);
          const fileVersion = fileVersionMatch
            ? parseInt(fileVersionMatch[1])
            : 0;

          // If the file has no version or the item version is higher, remove the file from disk
          if (!fileVersionMatch || version > fileVersion) {
            removeFile(`${episodePath}/${fileKey}`);
            // Keep item to download new version
            return true;
          }
          // Version is correct, remove item from results
          return false;
        }
      }

      const matchingFile = fileList[seasonFolder].some(
        (file) =>
          file.includes(episodeFile) || file.includes(`E${episodeNumber}`),
      );

      // Return true to keep the entry if no matching file is found
      return !matchingFile;
    } else {
      return true;
    }
  }

  // Remove entries that do not match the expected pattern
  return false;
};

/**
 * Set the path for the episode.
 * @param rootFolderPath the root folder path
 * @param entry The DownloadEntry
 * @param item The item to check
 * @returns TorrentData with path set
 */
const setEpisodePath = (
  rootFolderPath: string,
  entry: DownloadEntry,
  item: TorrentData,
) => {
  const pattern = validatePattern(entry.pattern) || defaultPattern;
  const match = item.title.match(pattern);
  if (match && match.length == 3) {
    const seasonNumber = parseInt(match[1], 10);
    const seasonFolder = `Season ${seasonNumber}`;
    item.path = `${rootFolderPath}/${entry.folder}/${seasonFolder}`;
    checkFolder(item.path);
  }
  return item;
};

export const handleDownloadingNewEpisodes = async (
  rootFolderPath: string,
  downloads: DownloadEntry[],
  downloadTracker: TrackerData[],
): Promise<TrackerData[]> => {
  logger.header(`Checking ${rootFolderPath} for new episodes...`);
  // Iterate through each metadata entry
  for (const entry of downloads) {
    // Skip completed entries
    if (entry.complete) {
      logger.info(`${entry.folder} - already complete.`);
      continue;
    }
    // Create workers
    let client: WebTorrent.Instance | null = null;
    let multiBar: cliProgress.MultiBar | null = null;

    try {
      // Scrape Nyaa search results
      const results = await scrapeNyaaSearchResults(entry);

      const fileList = getFileList(rootFolderPath, entry);
      const filteredResults = results
        .filter((result) => versionedEpisodes(results, entry, result))
        .filter((result) =>
          existingEpisodes(rootFolderPath, fileList, entry, result),
        )
        .map((result) => setEpisodePath(rootFolderPath, entry, result));

      const newEpisodes = filteredResults.length;
      logger.info(`${entry.folder} - new episodes: ${newEpisodes}`);

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
          title: entry.folder,
          newEpisodes: newEpisodes,
        });
      }
    } catch (error) {
      logger.error(
        `Error building URL or handling episodes for ${entry.folder}:`,
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
