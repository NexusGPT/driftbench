import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText } from '@driftbench/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const PLAN = join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml');
const SESSIONS = join(FIXTURE, 'sessions');
const NAMES = ['weekly-clean', 'weekly-skill-skipped', 'weekly-gate-violated'];

async function run(argv: string[], cwd = ROOT) {
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
  const code = await main(argv, io);
  return { code, ...output };
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full));
    }
  };
  await walk(dir);
  return out.sort();
}

function generate(out: string, ...extra: string[]) {
  return run(['estate', 'generate', '--map', MAP, '--plan', PLAN, '--out', out, ...extra]);
}

describe('driftbench estate generate', () => {
  let out: string;
  let first: Awaited<ReturnType<typeof run>>;

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    first = await generate(out);
  }, 60_000);

  it('writes the suite and its report, and exits 1 while specs are incomplete', async () => {
    expect(first.err).toBe('');
    expect(first.code).toBe(1);
    expect(first.out).toMatch(/total\s+44\s+30\s+14/);
    expect(first.out).toContain('Replay: 12 specs aligned to sessions, 10 planned to pass, 2 to fail.');
    const written = await files(out);
    expect(written).toContain('estate-generate-report.json');
    expect(written.filter((path) => path.startsWith('specs/'))).toHaveLength(30);
    expect(written.filter((path) => path.startsWith('incomplete/'))).toHaveLength(14);
  });

  it('finds the phrase bank and the session index beside the map', async () => {
    const report = JSON.parse(await readFile(join(out, 'estate-generate-report.json'), 'utf8'));
    expect(report.phrases.path).toBe(relative(out, join(FIXTURE, 'phrases.yaml')));
    expect(report.sessions).toEqual({ path: relative(out, join(SESSIONS, 'index.yaml')), sessions: 3 });
  });

  it('gives replay specs that pass and fail over the three sessions as planned', async () => {
    await replayAsPlanned(join(out, 'specs/replay'));
  }, 60_000);

  async function replayAsPlanned(suite: string): Promise<void> {
    const replay = await run([
      'replay',
      ...NAMES.map((name) => join(SESSIONS, `${name}.jsonl`)),
      '--decisions',
      ...NAMES.map((name) => join(SESSIONS, `${name}.decisions.jsonl`)),
      '--steps',
      ...NAMES.map((name) => join(SESSIONS, `${name}.steps.jsonl`)),
      '--suite',
      suite,
      '--json',
    ]);
    expect(replay.err).toBe('');
    expect(replay.code).toBe(1);
    const result = JSON.parse(replay.out) as {
      runs: Array<{ spec: string; session: string; aligned: string; pass: boolean; failing: string[] }>;
      notes: string[];
    };
    expect(result.notes).toEqual([]);
    expect(result.runs).toHaveLength(12);
    const planned = new Map<string, string>();
    for (const path of (await files(join(out, 'specs/replay'))).map((file) =>
      join(out, 'specs/replay', file),
    )) {
      const loaded = parseSpecText(await readFile(path, 'utf8'), 'yaml', path);
      if (!loaded.ok) throw new Error(`${path} is invalid`);
      const metadata = loaded.spec.metadata as {
        estate: { expect: string; session: string };
        replay: unknown;
      };
      planned.set(loaded.spec.id, metadata.estate.expect);
      expect(metadata.replay).toEqual({ session: metadata.estate.session, from_block: 0 });
    }
    for (const run of result.runs) {
      expect(run.aligned, run.spec).toBe('metadata');
      expect(run.pass ? 'pass' : 'fail', run.spec).toBe(planned.get(run.spec));
    }
    const failing = Object.fromEntries(
      result.runs.filter((entry) => !entry.pass).map((entry) => [entry.spec, entry.failing]),
    );
    expect(failing).toEqual({
      'estate.p01.weekly-skill-skipped': ['block 0: skills.weekly-report'],
      'estate.p02.weekly-gate-violated': ['block 0: custom.ordered.Read.Edit'],
    });
  }

  it('lints the complete specs clean', async () => {
    const lint = await run(['spec', 'lint', join(out, 'specs'), '--strict']);
    expect(lint.code).toBe(0);
    expect(lint.out).toContain('Checked 30 specs: 30 valid, 0 invalid, 0 warnings.');
  });

  it('refuses an earlier output without --force, and replaces it with --force', async () => {
    const again = await generate(out);
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/already exists: an earlier run wrote this folder/);
    await writeFile(join(out, 'keep.txt'), 'not ours');
    const forced = await generate(out, '--force');
    expect(forced.code).toBe(1);
    expect(await files(out)).toContain('keep.txt');
  });

  it('refuses a plan made from another map and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    const plan = (await readFile(PLAN, 'utf8')).replace(/^mapHash: .*$/m, `mapHash: ${'f'.repeat(64)}`);
    await writeFile(join(dir, 'plan.yaml'), plan);
    const result = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      join(dir, 'plan.yaml'),
      '--out',
      join(dir, 'out'),
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/plan\.mapHash {2}the plan was made from map ffffffffffff/);
    expect(await files(dir)).toEqual(['plan.yaml']);
  });

  it('refuses a bad seed, an invalid plan and a missing phrase bank', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    expect((await generate(join(dir, 'a'), '--seed', 'one')).code).toBe(2);
    await writeFile(join(dir, 'plan.yaml'), 'version: 1\nrows: []\n');
    const invalid = await run([
      'estate',
      'generate',
      '--map',
      MAP,
      '--plan',
      join(dir, 'plan.yaml'),
      '--out',
      join(dir, 'b'),
    ]);
    expect(invalid.code).toBe(2);
    expect(invalid.err).toMatch(/the plan cannot be read or is invalid/);
    const missing = await generate(join(dir, 'c'), '--phrases', join(dir, 'nowhere.yaml'));
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/the phrase bank cannot be read or is invalid/);
  });

  it('leaves replay rows waiting for a recorded session when no session index is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-generate-'));
    await copyFile(MAP, join(dir, 'approved.yaml'));
    await copyFile(join(FIXTURE, 'phrases.yaml'), join(dir, 'phrases.yaml'));
    const result = await run([
      'estate',
      'generate',
      '--map',
      join(dir, 'approved.yaml'),
      '--plan',
      PLAN,
      '--out',
      join(dir, 'out'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out);
    expect(report.sessions).toBeNull();
    expect(report.perMode.replay).toEqual({ rows: 4, specs: 4, complete: 0, incomplete: 4 });
    expect(
      report.gaps.find((entry: { marker: string }) => entry.marker === 'needs-recorded-session').specs,
    ).toBe(4);
  });
});
