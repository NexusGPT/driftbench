import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bankMeasure,
  defineLadder,
  type Ladder,
  registeredLadders,
  runSeeds,
  seedSpecs,
} from '@agent-nexus/driftbench-validators';
import { afterAll, describe, expect, it } from 'vitest';
import { bankLadder } from '../../validators/test/support';
import { USAGE_EXIT, type ValidateDeps } from '../src/commands/validate';
import { BEYOND_NOTE, splitBeyond } from '../src/commands/validate-beyond';
import { validateCommand } from '../src/commands/validate-run';

describe('the levels measured beyond the first failing level', () => {
  it('moves them to their own section, shows them as not run in the rows, keeps the level', async () => {
    const { ladder } = bankLadder([2]);
    const full = await runSeeds(ladder, seedSpecs([1, 2]), undefined, { full: true });
    const { report, beyond } = splitBeyond(full);
    // Seed 2 fails level 1: its level 2 was measured beyond; seed 1 fails level 2: nothing beyond.
    expect(report.level).toBe(full.level);
    expect(report.seeds.map((run) => run.level)).toEqual(full.seeds.map((run) => run.level));
    expect(report.seeds.map((run) => run.failing?.id)).toEqual(full.seeds.map((run) => run.failing?.id));
    expect(report.seeds[1]?.rows[1]).toMatchObject({ level: 2, observed: null, pass: null, itemCount: null });
    expect(report.seeds[1]?.rows[1]).not.toHaveProperty('bank');
    expect(report.seeds[1]?.rows[1]).not.toHaveProperty('beyond');
    expect(report.seeds[0]?.rows[1]).toMatchObject({ level: 2, pass: false });
    expect(beyond.note).toBe(BEYOND_NOTE);
    expect(beyond.seeds).toHaveLength(1);
    expect(beyond.seeds[0]).toMatchObject({ seed: 2, firstFailingLevel: 1 });
    const level = beyond.seeds[0]?.levels[0];
    expect(level).toMatchObject({ level: 2, id: 'deep', metThreshold: false, itemCount: 1 });
    // Not a verdict: the section never carries a `pass` field a reader could take for one.
    expect(level).not.toHaveProperty('pass');
    expect(level?.bank?.length).toBeGreaterThan(0);
  });

  it('leaves a stopping run as it is: nothing was measured beyond', async () => {
    const { ladder } = bankLadder([2]);
    const stopping = await runSeeds(ladder, seedSpecs([1, 2]));
    const { report, beyond } = splitBeyond(stopping);
    expect(report).toEqual(stopping);
    expect(beyond.seeds).toEqual([]);
  });

  it('marks the report of a ladder that reports them apart, and only that one', async () => {
    const { ladder } = bankLadder([2]);
    expect(await runSeeds(ladder, seedSpecs([1]))).not.toHaveProperty('beyondApart');
    const apart = defineLadder({ ...ladder, beyondApart: true });
    expect((await runSeeds(apart, seedSpecs([1]))).beyondApart).toBe(true);
  });

  it('is declared by the estate ladder only, among the registered ladders', () => {
    const apart = Object.entries(registeredLadders())
      .filter(([, ladder]) => ladder.beyondApart)
      .map(([name]) => name);
    expect(apart).toEqual(['estate']);
  });
});

// The two blockers of review 39835268871 (codex-review-validators, PR 1363 at 2c1580a9e), kept as red tests: a report
// split by beyondApart must join exactly as the same report unsplit.
describe('a report split by beyondApart joins like the unsplit report', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });
  async function root(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'validate-beyond-join-'));
    dirs.push(dir);
    await mkdir(join(dir, 'validators'));
    await writeFile(join(dir, 'validators/floors.json'), JSON.stringify({ version: 1, floors: {} }));
    return dir;
  }
  async function call(ladder: Ladder, options: Record<string, unknown>, dir: string) {
    const out = { out: '', err: '' };
    const code = await validateCommand(
      ladder.component,
      options,
      {
        cwd: dir,
        out: (text) => {
          out.out += text;
        },
        err: (text) => {
          out.err += text;
        },
      },
      { ladders: () => ({ [ladder.component]: ladder }), root: dir } as ValidateDeps,
    );
    return { code, ...out };
  }
  // Seven levels, level 2 fails; with `error`, level 7 (beyond the first failure) could not be measured.
  function sample(apart: boolean, error = false): Ladder {
    return defineLadder({
      component: 'estate',
      beyondApart: apart,
      levels: Array.from({ length: 7 }, (_, index) => ({
        id: `r${index + 1}`,
        name: `rung ${index + 1}`,
        metric: 'passing',
        threshold: 1,
        compute: () =>
          bankMeasure([
            {
              id: `item-${index + 1}`,
              component: 'fixture',
              family: 'fixture',
              tier: 1,
              pass: index !== 1 && !(error && index === 6),
              ...(error && index === 6 ? { error: 'fixture measurement unavailable' } : {}),
            },
          ]),
      })),
    });
  }
  async function joined(apart: boolean, error: boolean, options: Record<string, unknown>) {
    const dir = await root();
    const legs = join(dir, 'legs');
    await mkdir(legs);
    const leg = await call(sample(apart, error), { seed: '1', json: true, allLevels: true }, dir);
    await writeFile(join(legs, 'one.json'), leg.out);
    return call(sample(true, error), { reports: legs, seed: '1', json: true, ...options }, dir);
  }

  it('keeps a measurement error beyond the first failure: the join refuses it, as unsplit', async () => {
    const raw = await joined(false, true, { checkFloor: true });
    const split = await joined(true, true, { checkFloor: true });
    expect(raw.code).toBe(USAGE_EXIT);
    expect(split.code).toBe(USAGE_EXIT);
    expect(split.err).toContain('fixture measurement unavailable');
  });

  it('joins a full run of a split report as the unsplit one: same exit, same rows', async () => {
    const options = { allLevels: true, checkFloor: true };
    const raw = await joined(false, false, options);
    const split = await joined(true, false, options);
    expect(split.code).toBe(raw.code);
    expect(split.err).toBe(raw.err);
    const section = (text: string) => JSON.parse(text).beyondTheFirstFailingLevel;
    expect(section(split.out)).toEqual(section(raw.out));
  });

  it('keeps every bank, item and error of the levels beyond in the section', async () => {
    const dir = await root();
    const out = await call(sample(true, true), { seed: '1', json: true, allLevels: true }, dir);
    const levels = JSON.parse(out.out).beyondTheFirstFailingLevel.seeds[0].levels;
    expect(levels.map((level: { level: number }) => level.level)).toEqual([3, 4, 5, 6, 7]);
    for (const level of levels) expect(level.bank).toHaveLength(1);
    expect(levels[4].bank[0].error).toBe('fixture measurement unavailable');
    expect(levels[4].items.length).toBeGreaterThan(0);
  });
});
