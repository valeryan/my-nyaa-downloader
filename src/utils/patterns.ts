/**
 * Default patterns to match episode numbers.
 * Each pattern should have exactly 2 capture groups: season and episode.
 * Patterns are tried in order until one matches.
 */
const defaultPatterns = [
  /S(\d+)E(\d+)/i, // S01E01, S1E1, S01E1, S1E01, etc.
  /S(\d+)\s-\s(\d+)/, // S3 - 00, S1 - 01, etc.
  /(?:\s)(-)(?:\s)(\d+)/, // - 01, - 1, etc. (dash indicates season 1)
];

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

const episodeNumberPattern = (episodeNumber: string) =>
  new RegExp(`-\\s*${episodeNumber}\\b`);

/**
 * pattern to match HEVC within square brackets.
 * Matches [HEVC], [1080p AMZN WEBRip HEVC EAC3], etc.
 */
const hevc = /\[.*HEVC.*\]/i;

export const patterns = {
  defaultPatterns,
  versioned,
  resolution,
  episodeNumberPattern,
  hevc,
};
