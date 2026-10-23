import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptyFloors,
  type FloorsFile,
  floorOf,
  ladderVersion,
  readFloors,
  registeredLadders,
} from '../src/index';
import {
  checkRegressionReport,
  REGRESSION_FILE,
  type RegressionSeed,
  readRegressionSeeds,
  regressionThrough,
} from '../src/regression';

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

const floorsOf = (floor: number, version: number): FloorsFile => ({
  ...emptyFloors(),
  ladderVersion: { generator: version },
  floors: { generator: floor },
});

describe('regressionThrough', () => {
  it('runs the seed through the floor of its validator when that is above the level of the defect', () => {
    expect(regressionThrough(entry, floorsOf(8, 3), 3, 23)).toBe(8);
  });

  it('widens with the floor and never narrows the entry', () => {
    expect(regressionThrough(entry, floorsOf(11, 3), 3, 23)).toBe(11);
    expect(regressionThrough({ ...entry, through: 10 }, floorsOf(8, 3), 3, 23)).toBe(10);
  });

  it('ignores a floor of another ladder version, a validator without a floor, and stays under the top', () => {
    expect(regressionThrough(entry, floorsOf(8, 2), 3, 23)).toBe(2);
    expect(regressionThrough(entry, emptyFloors(), 3, 23)).toBe(2);
    expect(regressionThrough(entry, floorsOf(30, 3), 3, 23)).toBe(23);
  });

  it('runs every listed seed through the floor the repository holds for its validator', () => {
    const floors = readFloors(ROOT);
    for (const item of readRegressionSeeds(ROOT, TOPS)) {
      const ladder = registeredLadders()[item.component];
      expect(ladder, item.id).toBeDefined();
      if (!ladder) continue;
      const floor = floorOf(floors, item.component, ladderVersion(ladder));
      const through = regressionThrough(item, floors, ladderVersion(ladder), ladder.levels.length);
      expect(through, item.id).toBeGreaterThanOrEqual(Math.min(floor, ladder.levels.length));
      expect(through, item.id).toBeGreaterThanOrEqual(item.through);
    }
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

describe('the CI tool tools/ci/check-regression-seed.ts, run as the job runs it', () => {
  const tool = join(ROOT, 'tools/ci/check-regression-seed.ts');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', tool, ...args], { cwd: ROOT, encoding: 'utf8' });
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const reportFile = (report: unknown) => {
    const folder = mkdtempSync(join(tmpdir(), 'regression-tool-'));
    folders.push(folder);
    const path = join(folder, 'report.json');
    writeFileSync(path, JSON.stringify(report));
    return path;
  };

  it('loads and prints the last level of an entry: at least the level of its defect, and the floor of its validator', () => {
    const result = run('level', 'generator-732170008');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(Number(result.stdout.trim())).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('exits 1 on a report where a level of the entry fails, and 0 on one where every level passes', () => {
    const through = Number(run('level', 'generator-732170008').stdout.trim());
    const rows = (failAt?: number) =>
      Array.from({ length: through }, (_, index) => ({ level: index + 1, pass: index + 1 !== failAt }));
    const bad = run(
      'check',
      'generator-732170008',
      reportFile({ component: 'generator', seeds: [{ seed: 732170008, rows: rows(2) }] }),
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('level 2');
    const good = run(
      'check',
      'generator-732170008',
      reportFile({ component: 'generator', seeds: [{ seed: 732170008, rows: rows() }] }),
    );
    expect(good.status).toBe(0);
    expect(good.stdout).toContain(`levels 1 to ${through} pass`);
  }, 120_000);

  it('exits 2 for an entry that is not on the list', () => {
    expect(run('level', 'generator-1').status).toBe(2);
  }, 120_000);
});
