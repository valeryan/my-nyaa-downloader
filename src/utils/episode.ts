import { DownloadEntry, EntryFileList, EpisodeAttributes, TorrentData } from "../types";
import { checkFolder, getDateModified, removeFile } from "./file";
import { logger } from "./logger";
import { patterns } from "./patterns";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface ResolvedEpisode extends TorrentData {
  pattern: RegExp | null;
  seasonNumber: number;
  episodeNumber: string;
  episodeKey: string | null;
  isValid: boolean;
}

export interface EnhancedDownloadEntry extends DownloadEntry {
  resolvedPattern: RegExp | null;
}

// ============================================================================
// PATTERN RESOLUTION
// ============================================================================

const defaultPatterns = patterns.defaultPatterns;

/**
 * Validate the given pattern will return 2 groups.
 * @param pattern pattern to validate
 * @returns RegExp object or false if the pattern is invalid
 */
export const validatePattern = (pattern: string | undefined): RegExp | false => {
  if (!pattern) {
    return false;
  }
  try {
    const regex = new RegExp(pattern);
    const match = regex.source.match(/(?<!\\)\(/g);
    return match && match.length === 2 ? regex : false;
  } catch {
    return false;
  }
};

/**
 * Resolve the best pattern for an anime entry
 * @param anime The DownloadEntry
 * @param sampleTitle Optional sample title to test against
 * @returns Enhanced download entry with resolved pattern
 */
export const resolveAnimePattern = (
  anime: DownloadEntry,
  sampleTitle?: string,
): EnhancedDownloadEntry => {
  // First try the custom pattern if provided
  const customPattern = validatePattern(anime.pattern);
  if (customPattern) {
    if (!sampleTitle || sampleTitle.match(customPattern)) {
      return { ...anime, resolvedPattern: customPattern };
    }
  }

  // Try each default pattern in order
  for (const pattern of defaultPatterns) {
    if (!sampleTitle || sampleTitle.match(pattern)) {
      return { ...anime, resolvedPattern: pattern };
    }
  }

  return { ...anime, resolvedPattern: null };
};

/**
 * Resolve episode information from a title using a pattern
 * @param torrentData The torrent data
 * @param pattern The regex pattern to use
 * @returns Resolved episode information
 */
export const resolveEpisodeInfo = (
  torrentData: TorrentData,
  pattern: RegExp | null,
): ResolvedEpisode => {
  if (!pattern) {
    return {
      ...torrentData,
      pattern: null,
      seasonNumber: 1,
      episodeNumber: "",
      episodeKey: null,
      isValid: false,
    };
  }

  const match = torrentData.title.match(pattern);
  if (!match || match.length !== 3) {
    return {
      ...torrentData,
      pattern,
      seasonNumber: 1,
      episodeNumber: "",
      episodeKey: null,
      isValid: false,
    };
  }

  // Handle season extraction
  let seasonNumber = 1;
  if (match[1] === "-") {
    seasonNumber = 1; // Dash indicates season 1
  } else {
    seasonNumber = parseInt(match[1]) || 1;
  }

  const episodeNumber = match[2];
  const episodeKey = match[0];

  return {
    ...torrentData,
    pattern,
    seasonNumber,
    episodeNumber,
    episodeKey,
    isValid: true,
  };
};

/**
 * Resolve all episodes for an anime entry
 * @param anime Enhanced anime entry with resolved pattern
 * @param torrentList List of torrent data
 * @returns Array of resolved episodes
 */
export const resolveAllEpisodes = (
  anime: EnhancedDownloadEntry,
  torrentList: TorrentData[],
): ResolvedEpisode[] => {
  return torrentList.map((torrent) =>
    resolveEpisodeInfo(torrent, anime.resolvedPattern),
  );
};

// ============================================================================
// EPISODE PATH UTILITIES
// ============================================================================

/**
 * Set the download path for an episode based on its season
 * @param rootFolderPath Root folder for downloads
 * @param anime Enhanced anime entry
 * @param episode Resolved episode
 * @returns Updated torrent data with path
 */
export const setEpisodePath = (
  rootFolderPath: string,
  anime: EnhancedDownloadEntry,
  episode: ResolvedEpisode,
): TorrentData => {
  if (episode.isValid) {
    const seasonFolder = `Season ${episode.seasonNumber}`;
    episode.path = `${rootFolderPath}/${anime.folder}/${seasonFolder}`;
    checkFolder(episode.path);
  }
  return episode;
};

// ============================================================================
// EPISODE FILTERING
// ============================================================================

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
 * Filter episodes by resolution, keeping only the highest resolution
 */
export const filterByResolution = (
  resolvedEpisodes: ResolvedEpisode[],
  episode: ResolvedEpisode,
): boolean => {
  if (!episode.isValid || !episode.episodeKey) {
    return false;
  }

  // Find duplicates by episode key
  const duplicateEpisodes = resolvedEpisodes.filter(
    (ep) => ep.isValid && ep.episodeKey === episode.episodeKey,
  );

  if (duplicateEpisodes.length <= 1) {
    return true;
  }

  const resolutionPattern = patterns.resolution;
  const hasResolution = duplicateEpisodes.some((result) => {
    const resolutionMatch = result.title.match(resolutionPattern);
    return resolutionMatch !== null;
  });

  if (!hasResolution) {
    return true;
  }

  const highestResolution = duplicateEpisodes.reduce(
    (maxResolution, result) => {
      const resolutionMatch = result.title.match(resolutionPattern);
      const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 1080;
      return Math.max(maxResolution, resolution);
    },
    1080,
  );

  flagEpisodesForCleanup(episode.episodeKey, episode.seasonNumber, {
    resolution: highestResolution,
  });

  const resolutionMatch = episode.title.match(resolutionPattern);
  const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 1080;
  return resolution === highestResolution;
};

/**
 * Filter episodes by HEVC encoding, preferring HEVC when available
 */
export const filterByHEVC = (
  resolvedEpisodes: ResolvedEpisode[],
  episode: ResolvedEpisode,
): boolean => {
  if (!episode.isValid || !episode.episodeKey) {
    return false;
  }

  const duplicateEpisodes = resolvedEpisodes.filter(
    (ep) => ep.isValid && ep.episodeKey === episode.episodeKey,
  );

  if (duplicateEpisodes.length <= 1) {
    return true;
  }

  const hasHEVC = duplicateEpisodes.some((result) =>
    patterns.hevc.test(result.title),
  );
  if (!hasHEVC) {
    return true;
  }

  flagEpisodesForCleanup(episode.episodeKey, episode.seasonNumber, {
    encoding: "HEVC",
  });
  return patterns.hevc.test(episode.title);
};

/**
 * Filter episodes by version, keeping only the highest version
 */
export const filterByVersion = (
  resolvedEpisodes: ResolvedEpisode[],
  episode: ResolvedEpisode,
): boolean => {
  if (!episode.isValid || !episode.episodeKey) {
    return false;
  }

  const duplicateEpisodes = resolvedEpisodes.filter(
    (ep) => ep.isValid && ep.episodeKey === episode.episodeKey,
  );

  if (duplicateEpisodes.length <= 1) {
    return true;
  }

  const versionedPattern = patterns.versioned(episode.episodeKey);
  const hasVersion = duplicateEpisodes.some((result) => {
    const versionMatch = result.title.match(versionedPattern);
    return versionMatch !== null;
  });

  if (!hasVersion) {
    return true;
  }

  const highestVersion = duplicateEpisodes.reduce((maxVersion, result) => {
    const versionMatch = result.title.match(versionedPattern);
    const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;
    return Math.max(maxVersion, version);
  }, 1);

  flagEpisodesForCleanup(episode.episodeKey, episode.seasonNumber, {
    version: highestVersion,
  });

  const versionMatch = episode.title.match(versionedPattern);
  const version = versionMatch ? parseInt(versionMatch[1]) : 1;
  return version === highestVersion;
};

/**
 * Filter episodes by timestamp, keeping only the latest
 */
export const filterByLatestTimestamp = (
  resolvedEpisodes: ResolvedEpisode[],
  episode: ResolvedEpisode,
): boolean => {
  if (!episode.isValid || !episode.episodeKey) {
    return false;
  }

  const duplicateEpisodes = resolvedEpisodes.filter(
    (ep) => ep.isValid && ep.episodeKey === episode.episodeKey,
  );

  if (duplicateEpisodes.length <= 1) {
    return true;
  }

  const latestTimestamp = duplicateEpisodes.reduce((maxTimestamp, result) => {
    return Math.max(maxTimestamp, result.timestamp);
  }, 0);

  flagEpisodesForCleanup(episode.episodeKey, episode.seasonNumber, {
    timestamp: latestTimestamp,
  });
  return episode.timestamp === latestTimestamp;
};

/**
 * Filter out episodes that already exist in the file system
 */
export const filterExistingEpisodes = (
  fileList: EntryFileList,
  episode: ResolvedEpisode,
): boolean => {
  if (!episode.isValid) {
    return false;
  }

  const seasonFolder = `Season ${episode.seasonNumber}`;
  if (!fileList[seasonFolder]) {
    return true;
  }

  return !fileList[seasonFolder].some((file) => {
    if (!episode.pattern) return false;
    const fileMatch = file.match(episode.pattern);
    return (
      (fileMatch && fileMatch[2].toString() === episode.episodeNumber) ||
      patterns.episodeNumberPattern(episode.episodeNumber).test(file)
    );
  });
};

// ============================================================================
// EPISODE CLEANUP
// ============================================================================

/**
 * Clean up older/lower quality episodes based on flagged attributes
 */
export const cleanupEpisodesHandler = (
  rootFolderPath: string,
  fileList: EntryFileList,
  anime: EnhancedDownloadEntry,
) => {
  if (!fileList || Object.keys(fileList).length === 0) {
    return;
  }

  cleanupEpisodes.forEach((attributes, episodeKey) => {
    const seasonFolder = `Season ${attributes.season}`;
    const episodePath = `${rootFolderPath}/${anime.folder}/${seasonFolder}`;
    if (!fileList[seasonFolder]) {
      return;
    }
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
          return;
        }
      }

      // Handle resolutioned episodes
      if (attributes.resolution) {
        const resolution = `${attributes.resolution}p`;
        if (!file.includes(resolution)) {
          logger.info(`Removing old resolution: ${file}`);
          removeFile(`${episodePath}/${file}`);
          return;
        }
      }

      // Handle HEVC episodes
      if (attributes.encoding) {
        if (!file.includes(attributes.encoding)) {
          logger.info(`Removing old encoding: ${file}`);
          removeFile(`${episodePath}/${file}`);
          return;
        }
      }

      // Handle timestamped episodes
      if (attributes.timestamp) {
        const filePath = `${episodePath}/${file}`;
        const timestamp = attributes.timestamp * 1000; // Convert to milliseconds
        const fileModifiedTime = getDateModified(filePath).getTime();
        if (fileModifiedTime < timestamp) {
          logger.info(`Removing old timestamp: ${file}`);
          removeFile(filePath);
          return;
        }
      }
    });
  });
  cleanupEpisodes.clear();
};
