import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FALLBACK_HIDDEN_SEED, hiddenSeed, parseSeeds, runSeeds, seedSpecs } from '../src/index';
import { plantedLadder } from './support';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-seeds-test-'));
  made.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('parseSeeds', () => {
  it('reads --seed and --seeds a..b together, in order, without repeats', () => {
    expect(parseSeeds({})).toEqual([1]);
    expect(parseSeeds({ seed: '7' })).toEqual([7]);
    expect(parseSeeds({ seeds: '1..3' })).toEqual([1, 2, 3]);
    expect(parseSeeds({ seed: '2', seeds: '1..3' })).toEqual([2, 1, 3]);
  });
  it('names the problem with bad input', () => {
    expect(parseSeeds({ seed: '-1' })).toMatch(/whole number/);
    expect(parseSeeds({ seeds: '3..1' })).toMatch(/a <= b/);
    expect(parseSeeds({ seeds: '1-3' })).toMatch(/a\.\.b/);
    expect(parseSeeds({ seeds: '1..5000' })).toMatch(/at most 1000/);
  });
});

describe('the level of a run', () => {
  it('is the minimum over its seeds', async () => {
    const { ladder } = plantedLadder([3]);
    const report = await runSeeds(ladder, seedSpecs([1, 2, 3, 4]));
    expect(report.seeds.map((run) => run.level)).toEqual([3, 3, 1, 3]);
    expect(report.level).toBe(1);
  });
});

describe('hiddenSeed', () => {
  it('changes with HEAD', async () => {
    const repo = await temp();
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'tester@example.com');
    git(repo, 'config', 'user.name', 'Tester');
    git(repo, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'one');
    const first = hiddenSeed(repo);
    expect(first.source).toBe('head');
    expect(first.head).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(hiddenSeed(repo).seed).toBe(first.seed);
    await writeFile(join(repo, 'a.txt'), 'two\n');
    git(repo, 'commit', '-q', '-am', 'two');
    const second = hiddenSeed(repo);
    expect(second.seed).not.toBe(first.seed);
    for (const seed of [first.seed, second.seed]) {
      expect(seed).toBeGreaterThanOrEqual(1_000_000);
      expect(seed).toBeLessThan(1_001_000_000);
    }
  });
  it('is 1000000 plus the first 32 bits of the commit modulo 1000000000', () => {
    const head = 'ffffffff00000000000000000000000000000000';
    expect(hiddenSeed('.', () => head).seed).toBe(1_000_000 + (0xffffffff % 1_000_000_000));
  });
  it('falls back to a fixed seed with a note outside a repository', async () => {
    const outside = await temp();
    const result = hiddenSeed(outside, () => {
      throw new Error('fatal: not a git repository');
    });
    expect(result).toMatchObject({ seed: FALLBACK_HIDDEN_SEED, source: 'fallback' });
    expect(result.note).toContain('falls back to 7777777');
    expect(hiddenSeed(outside, () => 'garbage').source).toBe('fallback');
  });
});
