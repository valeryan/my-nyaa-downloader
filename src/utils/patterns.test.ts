import { describe, expect, it } from 'vitest';
import { patterns } from './patterns';

describe('patterns', () => {
  describe('defaultPatterns', () => {
    it('should contain season and episode patterns', () => {
      expect(patterns.defaultPatterns).toBeDefined();
      expect(patterns.defaultPatterns.length).toBe(3);
    });

    it('should match S01E01 format', () => {
      const seasonEpisodePattern = patterns.defaultPatterns[0];
      const match = 'S01E01'.match(seasonEpisodePattern);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('01'); // season with leading zero
      expect(match?.[2]).toBe('01'); // episode with leading zero
    });

    it('should match S1E1 format', () => {
      const seasonEpisodePattern = patterns.defaultPatterns[0];
      const match = 'S1E1'.match(seasonEpisodePattern);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('1');
      expect(match?.[2]).toBe('1');
    });

    it('should match S3 - 00 format', () => {
      const s3Pattern = patterns.defaultPatterns[1];
      const match = 'S3 - 00'.match(s3Pattern);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('3');
      expect(match?.[2]).toBe('00');
    });

    it('should match dash format " - 01"', () => {
      const dashPattern = patterns.defaultPatterns[2];
      const match = ' - 01'.match(dashPattern);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('-');
      expect(match?.[2]).toBe('01');
    });

    it('should not match invalid formats', () => {
      const allPatterns = patterns.defaultPatterns;
      const invalidFormats = ['E01', 'Season 1 Episode 1', '1x01', 'Ep01'];

      invalidFormats.forEach(format => {
        const hasMatch = allPatterns.some(pattern => pattern.test(format));
        expect(hasMatch).toBe(false);
      });
    });
  });
});
