import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkRegressionReport,
  REGRESSION_FILE,
  type RegressionSeed,
  readRegressionSeeds,
  registeredLadders,
} from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOPS = Object.fromEntries(
  Object.entries(registeredLadders()).map(([name, ladder]) => [name, ladder.levels.length]),
);

const entry: RegressionSeed = {
  id: 'generator-732170008',
  component: 'generator',
  seed: 732170008,
  through: 2,
  fixedBy: '#1464',
  defect: 'level 2 failed',
  evidence: 'a run',
};

const row = (level: number, pass: boolean | null, items: string[] = []) => ({
  level,
  id: `level-${level}`,
  pass,
  ...(items.length > 0 ? { items: items.map((id) => ({ id })) } : {}),
});
const report = (rows: ReturnType<typeof row>[], seed = 732170008, component = 'generator') => ({
  component,
  seeds: [{ seed, rows }],
});

describe('checkRegressionReport', () => {
  it('holds when every level from 1 through the entry passes', () => {
    expect(checkRegressionReport(entry, report([row(1, true), row(2, true)]))).toEqual([]);
    // a level above `through` does not count, pass or fail
    expect(checkRegressionReport(entry, report([row(1, true), row(2, true), row(3, false)]))).toEqual([]);
  });

  it('names the failing level and its items when the defect is back', () => {
    const problems = checkRegressionReport(
      entry,
      report([row(1, true), row(2, false, ['diff.feasible.cover', 'diff.feasible.graph'])]),
    );
    expect(problems).toEqual([
      'level 2 (level-2) of generator-732170008 fails: diff.feasible.cover, diff.feasible.graph',
    ]);
  });

  it('names the failing items from the bank when a row lists none', () => {
    const bank = {
      level: 2,
      id: 'differential',
      pass: false,
      bank: [
        { id: 'a', pass: true },
        { id: 'b', pass: false },
      ],
    };
    expect(checkRegressionReport(entry, report([row(1, true), bank as never]))).toEqual([
      'level 2 (differential) of generator-732170008 fails: b',
    ]);
  });

  it('never reads a level that was not computed as a pass', () => {
    expect(checkRegressionReport(entry, report([row(1, true), row(2, null)]))).toEqual([
      'level 2 of generator-732170008 was not computed',
    ]);
    expect(checkRegressionReport(entry, report([row(1, true)]))).toEqual([
      'level 2 of generator-732170008 was not computed',
    ]);
  });

  it('refuses a report of another seed, another component, several seeds, or no report', () => {
    const ok = [row(1, true), row(2, true)];
    expect(checkRegressionReport(entry, report(ok, 1))).toEqual([
      'the report of generator-732170008 does not hold seed 732170008 alone',
    ]);
    expect(checkRegressionReport(entry, report(ok, 732170008, 'map'))).toEqual([
      'the report of generator-732170008 is for map, not generator',
    ]);
    const two = { component: 'generator', seeds: [report(ok).seeds[0], report(ok, 1).seeds[0]] };
    expect(checkRegressionReport(entry, two)).toEqual([
      'the report of generator-732170008 does not hold seed 732170008 alone',
    ]);
    expect(checkRegressionReport(entry, { nothing: true })).toEqual([
      'the report of generator-732170008 is not a validate --json report',
    ]);
  });
});

describe('readRegressionSeeds', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const read = (value: unknown) => {
    const root = mkdtempSync(join(tmpdir(), 'regression-'));
    folders.push(root);
    mkdirSync(join(root, 'validators'), { recursive: true });
    writeFileSync(join(root, REGRESSION_FILE), JSON.stringify(value));
    return readRegressionSeeds(root, TOPS);
  };

  it('reads the list of the repository: every entry names a registered validator and a level it has', () => {
    const list = readRegressionSeeds(ROOT, TOPS);
    expect(list.map(({ id }) => id)).toContain('generator-732170008');
    for (const item of list) expect(item.through).toBeLessThanOrEqual(TOPS[item.component] as number);
  });

  it('holds no seed for an absent file', () => {
    const root = mkdtempSync(join(tmpdir(), 'regression-none-'));
    folders.push(root);
    expect(readRegressionSeeds(root, TOPS)).toEqual([]);
  });

  it('refuses a list that does not parse, a wrong id, a repeat, an unknown validator or a level past the top', () => {
    const file = (seeds: unknown[]) => ({ version: 1, seeds });
    expect(() => read({ version: 2, seeds: [] })).toThrow(/not a regression list/);
    expect(() => read(file([{ ...entry, extra: 1 }]))).toThrow(/not a regression list/);
    expect(() => read(file([{ ...entry, id: 'generator-1' }]))).toThrow(/is not generator-732170008/);
    expect(() => read(file([entry, entry]))).toThrow(/listed twice/);
    expect(() => read(file([{ ...entry, id: 'ghost-732170008', component: 'ghost' }]))).toThrow(
      /names no registered validator/,
    );
    expect(() => read(file([{ ...entry, through: 99 }]))).toThrow(/asks through level 99/);
    expect(read(file([entry]))).toEqual([entry]);
  });
});
