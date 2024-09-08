/**
 * pattern to match episode numbers.
 * Matches S01E01, S1E1, S01E1, S1E01, etc.
 */
const seasonAndEpisode = /S(\d+)E(\d+)/i;

/**
 * pattern to match versioned episodes.
 * Matches {episodeKey}v1, {episodeKey}v2, etc.
 */
const versioned = (episodeKey: string) =>
  new RegExp(`${episodeKey}v(\\d+)`, "i");

/**
 * pattern to match resolution.
 * Matches [720p], [1080p], etc.
 */
const resolution = /\[?(\d+)p\]?/i;

export const patterns = { seasonAndEpisode, versioned, resolution };
