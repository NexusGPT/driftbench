import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('offline hard-set, ledger, parser and budget invariants', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'comparisons/deepeval/hard'], {
    encoding: 'utf8',
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
