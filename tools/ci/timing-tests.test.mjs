import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timingTests } from '../../vitest.timing.ts';

const ROOT = join(import.meta.dirname, '..', '..');

describe('the timing test list', () => {
  it('names only test files that exist, once each', () => {
    expect(timingTests.length).toBeGreaterThan(0);
    expect(new Set(timingTests).size).toBe(timingTests.length);
    for (const file of timingTests) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });

  it('lists a file only when it reads a clock', () => {
    for (const file of timingTests)
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toMatch(
        /cpuUsage|performance\.now|hrtime|Date\.now/,
      );
  });
});
