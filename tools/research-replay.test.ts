import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const scripts = [
  'research/default-decoder-ungrounded/replay.mts',
  'research/evidence-source-alias/replay.mts',
];

// The replay scripts rebuild frozen snapshots from commits and recordings that CI does not hold.
// They broke once because the package default decoder changed while they relied on it. These checks
// run everywhere and pin the two things that broke: the decoder version and the input paths.
describe('research replay scripts', () => {
  it.each(scripts)('%s names the decoder version on every public parser call', (script) => {
    const text = readFileSync(resolve(root, script), 'utf8');
    const calls = text.match(/\b(?:production|parseJudgeText)\(\s*[^;]*?\)\s*[,;]/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/criterionDecoderVersion|\brequest\b/);
  });

  it('the default-decoder replay pins version 2 for the candidate and version 1 for the baseline', () => {
    const text = readFileSync(resolve(root, scripts[0]), 'utf8');
    expect(text).toMatch(/production\(row\.raw, \{ \.\.\.row\.request, criterionDecoderVersion: 2 \}\)/);
    expect(text).toMatch(/production\(row\.raw, \{ \.\.\.row\.request, criterionDecoderVersion: 1 \}\)/);
  });

  it('the source-alias replay reads its donor fixture from this repo', () => {
    const text = readFileSync(resolve(root, scripts[1]), 'utf8');
    expect(text).not.toContain('../default-decoder-ungrounded/packages');
    expect(
      existsSync(resolve(root, 'packages/judges/test/fixtures/criterion-decoder-recordings.json.gz')),
    ).toBe(true);
  });
});
