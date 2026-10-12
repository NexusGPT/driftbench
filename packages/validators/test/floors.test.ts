import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkFloors,
  emptyFloors,
  type FloorsFile,
  floorNote,
  floorOf,
  type LadderReport,
  type RaiseRequest,
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

async function evidence(failOn: number[] = [], version = 1): Promise<LadderReport & { hiddenSeed: object }> {
  const { ladder } = plantedLadder(failOn);
  const report = await runSeeds(
    { ...ladder, version },
    seedSpecs([1, 2, 3], { seed: 1_234_567, source: 'head', head: HEAD }),
  );
  return { ...report, hiddenSeed: { seed: 1_234_567, source: 'head', head: HEAD } };
}

const empty = emptyFloors();

function request(over: Partial<RaiseRequest> & { evidence: unknown }): RaiseRequest {
  return { component: 'planted', level: 3, top: 3, ladderVersion: 1, registeredVersion: 1, ...over };
}

describe('raiseFloor', () => {
  it('raises a floor with evidence reaching the level on every seed, the hidden seed included', async () => {
    const result = raiseFloor(empty, request({ evidence: await evidence() }));
    expect('file' in result && result.file.floors).toEqual({ planted: 3 });
    expect('file' in result && result.file.ladderVersion).toEqual({ planted: 1 });
    expect('file' in result && result.file.evidence?.planted).toEqual({
      level: 3,
      seeds: ['1', '2', '3', 'hidden'],
      hiddenSeed: 1_234_567,
      head: HEAD,
      ladderVersion: 1,
    });
  });
  it('refuses a lower or equal level within a ladder version: the floor only rises', async () => {
    const file: FloorsFile = { version: 2, ladderVersion: { planted: 1 }, floors: { planted: 2 } };
    for (const level of [1, 2]) {
      const result = raiseFloor(file, request({ level, evidence: await evidence() }));
      expect(result).toEqual({
        refused: `The floor of planted is 2; it only rises, so ${level} is refused.`,
      });
    }
  });
  it('starts a new ladder version at any level and keeps the earlier floor as history', async () => {
    const file: FloorsFile = {
      version: 2,
      ladderVersion: { planted: 1 },
      floors: { planted: 3 },
      evidence: { planted: { level: 3, seeds: ['1', 'hidden'], hiddenSeed: 5, ladderVersion: 1 } },
    };
    const result = raiseFloor(
      file,
      request({ level: 1, ladderVersion: 2, registeredVersion: 2, evidence: await evidence([2], 2) }),
    );
    if (!('file' in result)) throw new Error(result.refused);
    expect(result.file.ladderVersion).toEqual({ planted: 2 });
    expect(result.file.floors).toEqual({ planted: 1 });
    expect(result.file.history).toEqual({
      planted: [
        {
          ladderVersion: 1,
          floor: 3,
          evidence: { level: 3, seeds: ['1', 'hidden'], hiddenSeed: 5, ladderVersion: 1 },
        },
      ],
    });
    expect(floorOf(result.file, 'planted', 2)).toBe(1);
    expect(floorOf(result.file, 'planted', 1)).toBe(0);
  });
  it('refuses a version other than the registered one, a version below the file, and evidence of another version', async () => {
    const file: FloorsFile = { version: 2, ladderVersion: { planted: 2 }, floors: { planted: 1 } };
    expect(
      raiseFloor(file, request({ ladderVersion: 3, registeredVersion: 2, evidence: await evidence([], 3) })),
    ).toEqual({ refused: 'The registered planted ladder is version 2; a floor for version 3 is refused.' });
    expect(raiseFloor(file, request({ evidence: await evidence() }))).toEqual({
      refused: 'validators/floors.json is at ladder version 2 for planted; versions only rise.',
    });
    expect(
      raiseFloor(empty, request({ ladderVersion: 2, registeredVersion: 2, evidence: await evidence([], 1) })),
    ).toEqual({ refused: 'The evidence ran ladder version 1; the floor is for version 2.' });
  });
  it('refuses evidence that misses the level on a seed, lacks the hidden seed, or ran another ladder', async () => {
    expect(raiseFloor(empty, request({ level: 2, evidence: await evidence([2]) }))).toEqual({
      refused: 'The evidence does not reach 2 on seed 2.',
    });
    const visibleOnly = await evidence();
    visibleOnly.seeds = visibleOnly.seeds.filter((run) => !run.hidden);
    expect(raiseFloor(empty, request({ level: 1, evidence: visibleOnly }))).toEqual({
      refused: 'The evidence must run at least one visible seed and the hidden seed (--hidden).',
    });
    expect(raiseFloor(empty, request({ component: 'other', level: 1, evidence: await evidence() }))).toEqual({
      refused: 'The evidence holds no run of other.',
    });
    expect(raiseFloor(empty, request({ level: 1, top: 4, evidence: await evidence() }))).toEqual({
      refused: 'The evidence ran a ladder of 3 levels; planted now has 4.',
    });
    const lying = { ...(await evidence([2])), level: 3 };
    expect(raiseFloor(empty, request({ level: 1, evidence: lying }))).toEqual({
      refused: 'The evidence says level 3 but its seeds give 1.',
    });
    expect(raiseFloor(empty, request({ level: 4, evidence: await evidence() }))).toEqual({
      refused: 'planted has 3 levels; 4 is above its top.',
    });
  });
});

describe('checkFloors', () => {
  it('holds at or above the floor, fails below it, and names a floor without a validator', async () => {
    const { ladder } = plantedLadder([2]);
    const report = await runSeeds(ladder, seedSpecs([1, 2]));
    const file: FloorsFile = {
      version: 2,
      ladderVersion: { planted: 1, gone: 1 },
      floors: { planted: 2, gone: 1 },
    };
    const { checks, problems } = checkFloors([report], file, { planted: { top: 3, version: 1 } });
    expect(checks).toEqual([{ component: 'planted', level: 1, floor: 2, holds: false }]);
    expect(problems).toEqual([
      'validators/floors.json holds a floor for gone, which has no registered validator.',
    ]);
  });
  it('enforces the floor of the current ladder version only, and names a file ahead of the ladder', async () => {
    const { ladder } = plantedLadder([1]);
    const report = await runSeeds({ ...ladder, version: 2 }, seedSpecs([1]));
    const older: FloorsFile = { version: 2, ladderVersion: { planted: 1 }, floors: { planted: 3 } };
    const result = checkFloors([report], older, { planted: { top: 3, version: 2 } });
    expect(result.checks).toEqual([{ component: 'planted', level: 1, floor: 0, holds: true }]);
    expect(result.problems).toEqual([]);
    expect(floorNote(older, 'planted', 2)).toBe(
      'The floor 3 belongs to ladder version 1; version 2 has no floor yet.',
    );
    const ahead: FloorsFile = { version: 2, ladderVersion: { planted: 3 }, floors: { planted: 1 } };
    expect(checkFloors([report], ahead, { planted: { top: 3, version: 2 } }).problems).toEqual([
      'validators/floors.json holds ladder version 3 for planted, above the registered version 2.',
    ]);
  });
});

describe('readFloors and writeFloors', () => {
  it('reads an absent file as no floor, migrates a version 1 file to ladder version 1, and refuses a malformed one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-floors-test-'));
    made.push(root);
    expect(readFloors(root)).toEqual(empty);
    await mkdir(join(root, 'validators'));
    await writeFile(
      join(root, 'validators/floors.json'),
      JSON.stringify({
        version: 1,
        floors: { b: 1, a: 2 },
        evidence: { a: { level: 2, seeds: ['1', 'hidden'], hiddenSeed: 9 } },
      }),
    );
    const migrated = readFloors(root);
    expect(migrated).toEqual({
      version: 2,
      ladderVersion: { b: 1, a: 1 },
      floors: { b: 1, a: 2 },
      evidence: { a: { level: 2, seeds: ['1', 'hidden'], hiddenSeed: 9, ladderVersion: 1 } },
    });
    writeFloors(root, migrated);
    expect(JSON.parse(await readFile(join(root, 'validators/floors.json'), 'utf8'))).toEqual(migrated);
    expect(Object.keys(readFloors(root).floors)).toEqual(['a', 'b']);
    // Evidence for a component without a floor keeps ladder version 1, so the written-back file reads again.
    await writeFile(
      join(root, 'validators/floors.json'),
      JSON.stringify({
        version: 1,
        floors: { a: 2 },
        evidence: { c: { level: 1, seeds: ['1', 'hidden'], hiddenSeed: 3 } },
      }),
    );
    const evidenceOnly = readFloors(root);
    expect(evidenceOnly.ladderVersion).toEqual({ a: 1, c: 1 });
    writeFloors(root, evidenceOnly);
    expect(readFloors(root)).toEqual(evidenceOnly);
    await writeFile(join(root, 'validators/floors.json'), '{"version":1,"floors":{"a":-1}}');
    expect(() => readFloors(root)).toThrow(/not a floors file/);
    await writeFile(
      join(root, 'validators/floors.json'),
      '{"version":2,"ladderVersion":{},"floors":{"a":1}}',
    );
    expect(() => readFloors(root)).toThrow(/a floor names its ladder version/);
    await writeFile(
      join(root, 'validators/floors.json'),
      JSON.stringify({
        version: 2,
        ladderVersion: { a: 1 },
        floors: { a: 1 },
        history: { a: [{ ladderVersion: 1, floor: 2 }] },
      }),
    );
    expect(() => readFloors(root)).toThrow(/oldest first, all below the current one/);
  });
});
