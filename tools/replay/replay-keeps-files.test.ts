import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The free replays of the comparisons: each rebuilds a committed result file from recordings, with no
 * model call. A replay that reproduces the committed numbers must leave the committed bytes alone: the
 * repository formatter owns them, and a rewrite in another layout shows as a change that is none.
 */
const REPLAYS: Array<{ script: string; args: string[]; result: string }> = [
  {
    script: 'comparisons/promptfoo/hard/score.py',
    args: [],
    result: 'comparisons/promptfoo/hard/recorded/summary.json',
  },
  {
    script: 'comparisons/langfuse/hard/analyse.py',
    args: [],
    result: 'comparisons/langfuse/hard/scores.json',
  },
  {
    script: 'comparisons/langfuse/hard/analyse.py',
    args: ['--set', 'heldout-cases.json'],
    result: 'comparisons/langfuse/hard/heldout-scores.json',
  },
];

describe('the free replays of the comparisons', () => {
  for (const { script, args, result } of REPLAYS) {
    it(`python3 ${[script, ...args].join(' ')} leaves ${result} byte for byte`, () => {
      const path = `${ROOT}/${result}`;
      const before = readFileSync(path);
      try {
        execFileSync('python3', [`${ROOT}/${script}`, ...args], { cwd: ROOT, stdio: 'pipe' });
        expect(readFileSync(path).equals(before), `${result} was rewritten`).toBe(true);
      } finally {
        // A failing replay must not leave the working tree changed.
        if (!readFileSync(path).equals(before)) writeFileSync(path, before);
      }
    }, 120_000);
  }
});
