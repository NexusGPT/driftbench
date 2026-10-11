import { mkdtemp, rm } from 'node:fs/promises';
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
