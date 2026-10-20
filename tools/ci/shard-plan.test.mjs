import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { plan, weights } from './shard-plan.mjs';

const files = Array.from(
  { length: 40 },
  (_, at) => `packages/p/test/f${String(at).padStart(2, '0')}.test.ts`,
);
const durations = Object.fromEntries(files.slice(0, 30).map((file, at) => [file, 1000 * (at + 1)]));

describe('the shard plan', () => {
  it('places every file in exactly one shard', () => {
    const result = plan(files, durations, 7);
    const placed = result.shards.flatMap((shard) => shard.files);
    expect([...placed].sort()).toEqual([...files].sort());
    expect(new Set(placed).size).toBe(files.length);
  });
  it('gives a file with no measured duration the median weight', () => {
    const weight = weights(files, durations);
    expect(weight.get(files[35])).toBe(16000);
    expect(weight.get(files[0])).toBe(1000);
  });
  it('balances the load: no shard is above the average by more than the heaviest file', () => {
    const result = plan(files, durations, 7);
    const total = result.shards.reduce((sum, shard) => sum + shard.load, 0);
    const heaviest = 30000;
    for (const shard of result.shards) expect(shard.load).toBeLessThanOrEqual(total / 7 + heaviest);
    expect(
      Math.max(...result.shards.map((s) => s.load)) - Math.min(...result.shards.map((s) => s.load)),
    ).toBeLessThan(heaviest);
  });
  it('gives the same plan for the same inputs, whatever the order of the files', () => {
    expect(plan([...files].reverse(), durations, 5)).toEqual(plan(files, durations, 5));
  });
  it('puts a file heavier than the average load alone in a shard', () => {
    const heavy = { ...durations, [files[0]]: 500000 };
    const result = plan(files, heavy, 7);
    const shard = result.shards.find((each) => each.files.includes(files[0]));
    expect(shard?.files).toEqual([files[0]]);
  });
  it('refuses a count that is not a positive integer, and tolerates more shards than files', () => {
    expect(() => plan(files, durations, 0)).toThrow();
    expect(() => plan(files, durations, 1.5)).toThrow();
    expect(
      plan(files.slice(0, 3), durations, 5).shards.filter((shard) => shard.files.length === 0),
    ).toHaveLength(2);
  });
});

describe('the shard plan the CI writes', () => {
  it('holds every test file vitest lists, .ts and .mjs, each in exactly one shard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shard-plan-'));
    try {
      const out = join(dir, 'plan.json');
      const written = spawnSync(
        process.execPath,
        ['tools/ci/shard-plan.mjs', '--count', '32', '--out', out],
        {
          encoding: 'utf8',
        },
      );
      expect(written.status, written.stderr).toBe(0);
      // The listing is read here from vitest itself, with no filter of ours between it and the comparison.
      const listed = spawnSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(listed.status, listed.stderr).toBe(0);
      const all = listed.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      expect(all.some((file) => file.endsWith('.mjs'))).toBe(true);
      expect(all.some((file) => file.endsWith('.ts'))).toBe(true);
      const planned = JSON.parse(readFileSync(out, 'utf8')).shards.flatMap((shard) => shard.files);
      const duplicated = planned.filter((file, at) => planned.indexOf(file) !== at);
      expect(duplicated, 'planned more than once').toEqual([]);
      expect(
        all.filter((file) => !planned.includes(file)),
        'listed, in no shard',
      ).toEqual([]);
      expect(
        planned.filter((file) => !all.includes(file)),
        'planned, not listed',
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
