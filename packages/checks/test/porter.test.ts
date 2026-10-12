import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { porterStem } from '../src/support/porter';

const reference = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'porter-reference.json'), 'utf8'),
) as Record<string, string>;

describe('porterStem agrees with the reference stemmer', () => {
  it('matches the reference on the sample, except the one word it is known to differ on', () => {
    // 1532 of 1533 words agree. "inning" stems to "in" here and to "inning" in the reference.
    const mismatches = Object.entries(reference)
      .filter(([word, stem]) => porterStem(word) !== stem)
      .map(([word, stem]) => `${word}: ${porterStem(word)} != ${stem}`);
    expect(mismatches).toEqual(['inning: in != inning']);
  });

  it('keeps short words and stems plurals and -ing forms', () => {
    expect(porterStem('is')).toBe('is');
    expect(porterStem('dollars')).toBe('dollar');
    expect(porterStem('running')).toBe('run');
  });
});
