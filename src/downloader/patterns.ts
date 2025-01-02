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
 * Matches (720p), [720p], (1080p), [1080p], (1080p AMZN WEBRip HEVC EAC3), [1080p AMZN WEBRip HEVC EAC3], etc.
 */
const resolution = /[[(](?:[^\])]* )?(\d+)p(?: [^\])]*)?[\])]/i;

const episodeNumberPattern = (episodeNumber: string) => new RegExp(`-\\s*${episodeNumber}\\b`);

/**
 * pattern to match HEVC within square brackets.
 * Matches [HEVC], [1080p AMZN WEBRip HEVC EAC3], etc.
 */
const hevc = /\[.*HEVC.*\]/i;

export const patterns = { seasonAndEpisode, versioned, resolution, episodeNumberPattern, hevc };
