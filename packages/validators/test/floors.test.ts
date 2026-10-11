import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkFloors,
  type FloorsFile,
  type LadderReport,
  raiseFloor,
  readFloors,
  runSeeds,
  seedSpecs,
  writeFloors,
} from '../src/index';
import { plantedLadder } from './support';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';

async function evidence(failOn: number[] = []): Promise<LadderReport & { hiddenSeed: object }> {
  const { ladder } = plantedLadder(failOn);
  const report = await runSeeds(
    ladder,
    seedSpecs([1, 2, 3], { seed: 1_234_567, source: 'head', head: HEAD }),
  );
  return { ...report, hiddenSeed: { seed: 1_234_567, source: 'head', head: HEAD } };
}

const empty: FloorsFile = { version: 1, floors: {} };

describe('raiseFloor', () => {
  it('raises a floor with evidence reaching the level on every seed, the hidden seed included', async () => {
    const result = raiseFloor(empty, { component: 'planted', level: 3, evidence: await evidence(), top: 3 });
    expect('file' in result && result.file.floors).toEqual({ planted: 3 });
    expect('file' in result && result.file.evidence?.planted).toEqual({
      level: 3,
      seeds: ['1', '2', '3', 'hidden'],
      hiddenSeed: 1_234_567,
      head: HEAD,
    });
  });
  it('refuses a lower or equal level: the floor only rises', async () => {
    const file: FloorsFile = { version: 1, floors: { planted: 2 } };
    for (const level of [1, 2]) {
      const result = raiseFloor(file, { component: 'planted', level, evidence: await evidence(), top: 3 });
      expect(result).toEqual({
        refused: `The floor of planted is 2; it only rises, so ${level} is refused.`,
      });
    }
  });
  it('refuses evidence that misses the level on a seed, lacks the hidden seed, or ran another ladder', async () => {
    const short = raiseFloor(empty, {
      component: 'planted',
      level: 2,
      evidence: await evidence([2]),
      top: 3,
    });
    expect(short).toEqual({ refused: 'The evidence does not reach 2 on seed 2.' });
    const visibleOnly = await evidence();
    visibleOnly.seeds = visibleOnly.seeds.filter((run) => !run.hidden);
    expect(raiseFloor(empty, { component: 'planted', level: 1, evidence: visibleOnly, top: 3 })).toEqual({
      refused: 'The evidence must run at least one visible seed and the hidden seed (--hidden).',
    });
    expect(raiseFloor(empty, { component: 'other', level: 1, evidence: await evidence(), top: 3 })).toEqual({
      refused: 'The evidence holds no run of other.',
    });
    expect(raiseFloor(empty, { component: 'planted', level: 1, evidence: await evidence(), top: 4 })).toEqual(
      {
        refused: 'The evidence ran a ladder of 3 levels; planted now has 4.',
      },
    );
    const lying = { ...(await evidence([2])), level: 3 };
    expect(raiseFloor(empty, { component: 'planted', level: 1, evidence: lying, top: 3 })).toEqual({
      refused: 'The evidence says level 3 but its seeds give 1.',
    });
    expect(raiseFloor(empty, { component: 'planted', level: 4, evidence: await evidence(), top: 3 })).toEqual(
      {
        refused: 'planted has 3 levels; 4 is above its top.',
      },
    );
  });
});

describe('checkFloors', () => {
  it('holds at or above the floor, fails below it, and names a floor without a validator', async () => {
    const { ladder } = plantedLadder([2]);
    const report = await runSeeds(ladder, seedSpecs([1, 2]));
    const file: FloorsFile = { version: 1, floors: { planted: 2, gone: 1 } };
    const { checks, problems } = checkFloors([report], file, { planted: { top: 3 } });
    expect(checks).toEqual([{ component: 'planted', level: 1, floor: 2, holds: false }]);
    expect(problems).toEqual([
      'validators/floors.json holds a floor for gone, which has no registered validator.',
    ]);
  });
});

describe('readFloors and writeFloors', () => {
  it('reads an absent file as no floor, round-trips a file, and refuses a malformed one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-floors-test-'));
    made.push(root);
    expect(readFloors(root)).toEqual(empty);
    await mkdir(join(root, 'validators'));
    writeFloors(root, { version: 1, floors: { b: 1, a: 2 } });
    expect(await readFile(join(root, 'validators/floors.json'), 'utf8')).toBe(
      '{\n  "version": 1,\n  "floors": {\n    "a": 2,\n    "b": 1\n  }\n}\n',
    );
    await writeFile(join(root, 'validators/floors.json'), '{"version":1,"floors":{"a":-1}}');
    expect(() => readFloors(root)).toThrow(/not a floors file/);
  });
});
