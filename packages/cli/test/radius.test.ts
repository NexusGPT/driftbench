import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[], cwd = ROOT) {
  const io = { out: '', err: '' };
  const handle: Io = {
    out: (text) => {
      io.out += text;
    },
    err: (text) => {
      io.err += text;
    },
    cwd,
  };
  const code = await main(argv, handle);
  return { code, ...io };
}

const GATED = 'examples/acme/gated/specs';
const manifest = (name: string) => `examples/acme/radius/${name}.yaml`;

describe('driftbench radius', () => {
  it('prints the radius of a stage change against the whole suite, and exits 0', async () => {
    const run = await cli(['radius', GATED, '--change', manifest('stage-recap')]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    const lines = run.out.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.',
      '195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).',
      'Mode F, free-running: 298 of 861 blocks in the radius (233 direct, 65 forward), 563 out. 102 of 195 cells.',
      '  A cell reruns whole: 601 of 861 blocks sent, 30.2% saved; 93 of 195 cells left to carry.',
    ]);
    expect(lines[4]).toBe('In the radius, mode F:');
    // One row per cell in the radius, under the header.
    expect(lines.slice(6).filter((line) => line.trim() !== '')).toHaveLength(102);
    expect(run.out).toContain('gen-graph-001');
  });

  it('plans several modes: a T block runs alone, so nothing follows a direct block', async () => {
    const run = await cli([
      'radius',
      GATED,
      '--change',
      manifest('tool-coverage-check-input'),
      '--mode',
      'F,T',
    ]);
    expect(run.code).toBe(0);
    expect(run.out).toContain(
      'Mode F, free-running: 316 of 861 blocks in the radius (86 direct, 230 forward), 545 out. 86 of 195 cells.',
    );
    expect(run.out).toContain(
      'Mode T, teacher-forced: 86 of 861 blocks in the radius (86 direct, 0 forward), 775 out. 86 of 195 cells.',
    );
  });

  it('exits 1 and says why when the radius is the whole suite', async () => {
    const language = await cli(['radius', GATED, '--change', manifest('reply-language')]);
    expect(language.code).toBe(1);
    expect(language.out).toContain(
      'The radius is the whole suite: rule:reply_language: the reply language rule holds on every block. Nothing can be carried.',
    );
    const unknown = await cli(['radius', GATED, '--change', manifest('new-tool')]);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('tool:loyalty.lookup: no block declares a dependency on it');
  });

  it('puts every block of a hand-written spec in the radius: its dependencies are unknown', async () => {
    const run = await cli([
      'radius',
      'examples/acme/specs/conversations',
      '--change',
      manifest('tool-coverage-check-input'),
      '--json',
    ]);
    expect(run.code).toBe(0);
    const report = JSON.parse(run.out) as {
      whole: unknown;
      totals: { F: { in: number; total: number; unknown: number } };
    };
    expect(report.whole).toBeNull();
    expect(report.totals.F.unknown).toBe(report.totals.F.total);
    expect(report.totals.F.in).toBe(report.totals.F.total);
  });

  it('prints one JSON document with the manifest hash, the totals and every block state', async () => {
    const run = await cli(['radius', GATED, '--change', manifest('deviation-goal-shift'), '--json']);
    expect(run.code).toBe(0);
    const report = JSON.parse(run.out) as {
      manifest: { hash: string; from: string; to: string; changes: string[] };
      totals: { F: { in: number; direct: number; forward: number; sent: number; cells: { in: number } } };
      specs: { specId: string; blocks: { id: string; state: { F: string }; why: string[] }[] }[];
    };
    expect(report.manifest).toEqual({
      hash: 'a393cc307eff',
      from: 'acme-v1',
      to: 'acme-v2',
      changes: ['deviation:D2'],
    });
    expect(report.totals.F).toMatchObject({ in: 22, direct: 9, forward: 13, sent: 55, cells: { in: 9 } });
    const twise = report.specs.find((spec) => spec.specId === 'gen-twise-003');
    expect(twise?.blocks.map((block) => block.state.F)).toEqual([
      'out',
      'out',
      'out',
      'direct',
      'forward',
      'forward',
    ]);
  });

  it('exits 2 on a manifest that is missing, malformed, or holds an unknown field', async () => {
    const missing = await cli(['radius', GATED, '--change', join(dir, 'none.yaml')]);
    expect(missing.code).toBe(2);
    await writeFile(join(dir, 'bad.yaml'), 'from: v1\nchanges:\n  - kind: stage\n    stage: recap\n');
    const bad = await cli(['radius', GATED, '--change', join(dir, 'bad.yaml')]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('The change manifest is invalid, so no radius was computed.');
    expect(bad.out).toBe('');
    const mode = await cli(['radius', GATED, '--change', manifest('stage-recap'), '--mode', 'X']);
    expect(mode.code).toBe(2);
    const none = await cli(['radius', GATED]);
    expect(none.code).toBe(2);
  });

  it('refuses to narrow an empty manifest between two different versions', async () => {
    await writeFile(join(dir, 'empty.yaml'), 'from: v1\nto: v2\nchanges: []\n');
    const run = await cli(['radius', GATED, '--change', join(dir, 'empty.yaml')]);
    expect(run.code).toBe(1);
    expect(run.out).toContain('the manifest lists no change between two different versions');
  });
});
