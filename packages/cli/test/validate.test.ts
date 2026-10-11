import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { plantedLadder } from '../../validators/test/support';
import { USAGE_EXIT, type ValidateDeps, validateCommand } from '../src/commands/validate';
import type { Io } from '../src/io';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-validate-test-'));
  made.push(dir);
  return dir;
}

function capture(cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  return { io, output };
}

async function deps(failOn: number[] = [2]): Promise<ValidateDeps> {
  const root = await temp();
  const { ladder } = plantedLadder(failOn);
  return { ladders: () => ({ planted: ladder }), root };
}

describe('driftbench validate <component>', () => {
  it('exits with the highest level passed', async () => {
    const d = await deps([2]);
    const ok = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '1' }, ok.io, d)).toBe(3);
    const failing = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '2' }, failing.io, d)).toBe(1);
    expect(failing.output.out).toContain('Seed 2, level 2 second (second rung), 2 items:');
  });

  it('writes the report as JSON with --json', async () => {
    const d = await deps([2]);
    const { io, output } = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '2', json: true }, io, d)).toBe(1);
    const report = JSON.parse(output.out);
    expect(report.component).toBe('planted');
    expect(report.level).toBe(1);
    expect(report.seeds[0].failing.items.map((item: { id: string }) => item.id)).toEqual([
      'plant-2-a',
      'plant-2-b',
    ]);
  });

  it('refuses an unknown component and a bad seed with the usage exit code', async () => {
    const d = await deps();
    const unknown = capture(d.root as string);
    expect(await validateCommand('nothing', {}, unknown.io, d)).toBe(USAGE_EXIT);
    expect(unknown.output.err).toContain('Registered: planted.');
    const bad = capture(d.root as string);
    expect(await validateCommand('planted', { seed: 'x' }, bad.io, d)).toBe(USAGE_EXIT);
  });
});

describe('driftbench validate seeds', () => {
  it('reports every seed and exits with the minimum level over them', async () => {
    const d = await deps([3]);
    const { io, output } = capture(d.root as string);
    expect(await validateCommand('planted', { seeds: '1..3' }, io, d)).toBe(1);
    expect(output.out).toContain('Level per seed: 1 = 3, 2 = 3, 3 = 1');
    expect(output.out).toContain('Level of the run: 1 of 3, the minimum over 3 seeds.');
  });

  it('adds the hidden seed from the commit with --hidden, and notes the fallback outside a repository', async () => {
    const d = await deps([]);
    const head = 'abcdef0123456789abcdef0123456789abcdef01';
    const withHead = capture(d.root as string);
    const code = await validateCommand('planted', { seeds: '1..2', hidden: true, json: true }, withHead.io, {
      ...d,
      readHead: () => head,
    });
    expect(code).toBe(3);
    const report = JSON.parse(withHead.output.out);
    expect(report.seeds.map((run: { hidden: boolean }) => run.hidden)).toEqual([false, false, true]);
    expect(report.hiddenSeed).toMatchObject({ source: 'head', head });
    expect(report.seeds[2].seed).toBe(report.hiddenSeed.seed);
    const outside = capture(d.root as string);
    await validateCommand('planted', { hidden: true }, outside.io, {
      ...d,
      readHead: () => {
        throw new Error('fatal: not a git repository');
      },
    });
    expect(outside.output.out).toContain('Note: git rev-parse HEAD failed');
    expect(outside.output.out).toContain('seed hidden');
  });

  it('runs every registered validator with all and exits with the lowest level', async () => {
    const root = await temp();
    const { ladder: low } = plantedLadder([1], 'low');
    const { ladder: high } = plantedLadder([], 'high');
    const { io, output } = capture(root);
    expect(await validateCommand('all', {}, io, { ladders: () => ({ low, high }), root })).toBe(1);
    expect(output.out).toContain('Validator high');
    expect(output.out).toContain('Validator low');
  });
});

describe('driftbench validate floors', () => {
  async function withFloors(floors: Record<string, number>, failOn: number[] = []) {
    const d = await deps(failOn);
    await mkdir(join(d.root as string, 'validators'));
    await writeFile(
      join(d.root as string, 'validators/floors.json'),
      `${JSON.stringify({ version: 1, floors }, null, 2)}\n`,
    );
    return { ...d, readHead: () => 'abcdef0123456789abcdef0123456789abcdef01' };
  }

  it('--check-floor exits 1 below the floor and 0 at or above it', async () => {
    const d = await withFloors({ planted: 2 }, [2]);
    const below = capture(d.root as string);
    expect(await validateCommand('planted', { seeds: '1..2', checkFloor: true }, below.io, d)).toBe(1);
    expect(below.output.out).toContain('Floor: 2. BELOW THE FLOOR.');
    expect(below.output.err).toContain('planted is at level 1, below its floor 2.');
    const holds = capture(d.root as string);
    expect(await validateCommand('planted', { seed: '1', checkFloor: true }, holds.io, d)).toBe(0);
    expect(holds.output.out).toContain('Floor: 2. At or above the floor.');
  });

  it('--raise rewrites the file upward from --json evidence and refuses a lower level', async () => {
    const d = await withFloors({ planted: 1 });
    const run = capture(d.root as string);
    await validateCommand('planted', { seeds: '1..3', hidden: true, json: true }, run.io, d);
    const evidencePath = join(d.root as string, 'evidence.json');
    await writeFile(evidencePath, run.output.out);
    const raised = capture(d.root as string);
    expect(
      await validateCommand('floors', { raise: 'planted', evidence: 'evidence.json' }, raised.io, d, '3'),
    ).toBe(0);
    expect(raised.output.out).toContain('rises from 1 to 3');
    const file = JSON.parse(await readFile(join(d.root as string, 'validators/floors.json'), 'utf8'));
    expect(file.floors).toEqual({ planted: 3 });
    const lower = capture(d.root as string);
    expect(
      await validateCommand('floors', { raise: 'planted', evidence: 'evidence.json' }, lower.io, d, '2'),
    ).toBe(1);
    expect(lower.output.err).toContain('Refused: The floor of planted is 3; it only rises, so 2 is refused.');
    expect(
      JSON.parse(await readFile(join(d.root as string, 'validators/floors.json'), 'utf8')).floors,
    ).toEqual({
      planted: 3,
    });
  });
});
