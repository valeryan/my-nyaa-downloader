import * as cliProgress from "cli-progress";
import WebTorrent from "webtorrent";
import { DownloadEntry, TrackerData } from "../types";
import {
  cleanupEpisodesHandler,
  filterByHEVC,
  filterByLatestTimestamp,
  filterByResolution,
  filterByVersion,
  filterExistingEpisodes,
  resolveAllEpisodes,
  resolveAnimePattern,
  setEpisodePath
} from "../utils/episode";
import { getFileList } from "../utils/file";
import { logger } from "../utils/logger";
import { scrapeNyaaSearchResults } from "./nyaa";
import { chunkArray, downloadTorrent } from "./torrent";

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

      // Resolve pattern once and pre-process all episodes
      const enhancedAnime = resolveAnimePattern(anime, available[0]?.title);
      const resolvedEpisodes = resolveAllEpisodes(enhancedAnime, available);

      // Filter to only valid episodes (those that matched the pattern)
      const validEpisodes = resolvedEpisodes.filter((ep) => ep.isValid);

      // Apply special filters using resolved data
      let specialFilters = validEpisodes.filter((episode) =>
        filterByResolution(validEpisodes, episode),
      );
      specialFilters = specialFilters.filter((episode) =>
        filterByHEVC(validEpisodes, episode),
      );
      specialFilters = specialFilters.filter((episode) =>
        filterByVersion(validEpisodes, episode),
      );
      specialFilters = specialFilters.filter((episode) =>
        filterByLatestTimestamp(validEpisodes, episode),
      );

      // Cleanup special episodes - pass resolved episodes for efficiency
      cleanupEpisodesHandler(rootFolderPath, fileList, enhancedAnime);

      // Filter out existing episodes and update the path
      const filteredResults = specialFilters
        .filter((episode) => filterExistingEpisodes(fileList, episode))
        .map((episode) =>
          setEpisodePath(rootFolderPath, enhancedAnime, episode),
        );

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

        let successfulDownloads = 0;

        // Split the filtered results into chunks of 6
        const chunks = chunkArray(filteredResults, 6);

        // Process each chunk sequentially
        for (const chunk of chunks) {
          const downloadPromises = chunk.map(({ magnetLink, path }) => {
            if (magnetLink && path) {
              return downloadTorrent(client!, multiBar!, magnetLink, path);
            }
            return Promise.reject(new Error("Missing magnetLink or path"));
          });

          const results = await Promise.allSettled(downloadPromises);

          results.forEach((result) => {
            if (result.status === "fulfilled") {
              successfulDownloads++;
            } else {
              logger.error(
                `Error downloading torrent: ${
                  result.reason instanceof Error
                    ? result.reason.message
                    : result.reason
                }`,
              );
            }
          });
        }

        // Tear down the progress bar and WebTorrent client
        multiBar.stop();
        multiBar = null;
        client.destroy();
        client = null;

        // Add the series and new episode count to the download tracker
        downloadTracker.push({
          title: anime.folder,
          newEpisodes: successfulDownloads,
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
