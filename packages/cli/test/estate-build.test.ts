import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { estateApproveCommand, estateMapCommand, estateScanCommand } from '../src/commands/estate';
import { estateBuildCommand } from '../src/commands/estate-build';
import { estateGenerateCommand } from '../src/commands/estate-generate';
import { estatePlanApproveCommand, estatePlanCommand } from '../src/commands/estate-plan';
import type { Io } from '../src/io';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));
const NOW = () => new Date('2026-01-01T00:00:00Z');

function capture(cwd: string): { io: Io; out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    io: {
      cwd,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    out: () => out,
    err: () => err,
  };
}

/** A folder holding a copy of the fixture estate, without its committed suite, as `estate/`. */
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-build-'));
  await cp(FIXTURE, join(root, 'estate'), { recursive: true });
  await rm(join(root, 'estate', 'generated'), { recursive: true, force: true });
  return root;
}

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Every file under a folder, as path and content hash. */
async function hashes(dir: string, skip: string[] = []): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const visit = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (!skip.includes(entry.name)) found[relative(dir, full)] = sha(await readFile(full));
    }
  };
  await visit(dir);
  return found;
}

type BuildOptions = Parameters<typeof estateBuildCommand>[1];

async function build(root: string, options: BuildOptions, answers?: boolean[]) {
  const seen = capture(root);
  const questions: string[] = [];
  const code = await estateBuildCommand(
    'estate',
    {
      out: 'b',
      states: join(root, 'estate', 'live', 'states', 'library.json'),
      ...(options.pointer ? {} : { replay: 'estate/answers.yaml' }),
      ...options,
    },
    seen.io,
    {
      now: NOW,
      interactive: answers !== undefined,
      ask: async (question) => {
        questions.push(question);
        return answers?.shift() ?? false;
      },
    },
  );
  return { code, out: seen.out(), err: seen.err(), questions };
}

describe('driftbench estate build', () => {
  it('writes the files the single commands write, byte for byte', async () => {
    const root = await workspace();
    const built = await build(root, { yes: true });
    expect(built.err).toBe('');
    // The fixture leaves tests incomplete, so the last stage exits 1, as estate generate does.
    expect(built.code).toBe(1);
    expect(built.out).toContain('1. Read the estate:');
    expect(built.out).toContain('2. Approve the atoms: approved all, as --yes says.');
    expect(built.out).toMatch(/4\. Approve the plan: approved all \d+ tests, as --yes says\./);
    expect(built.out).toContain('5. Write the tests:');

    const by = capture(join(root, 's'));
    await mkdir(join(root, 's'));
    const steps = [
      await estateScanCommand(
        join(root, 'estate'),
        { out: join(root, 's', 'map.yaml'), force: true, replay: join(root, 'estate', 'answers.yaml') },
        by.io,
        { now: NOW },
      ),
      await estateApproveCommand(
        join(root, 's', 'map.yaml'),
        { all: true, to: join(root, 's', 'approved.yaml') },
        by.io,
      ),
      await estateMapCommand(join(root, 's', 'approved.yaml'), { to: join(root, 's', 'space.yaml') }, by.io),
      await estatePlanCommand(
        join(root, 's', 'approved.yaml'),
        { out: join(root, 's', 'plan.yaml'), space: join(root, 's', 'space.yaml'), force: true },
        by.io,
      ),
      await estatePlanApproveCommand(join(root, 's', 'plan.yaml'), { all: true }, by.io),
      await estateGenerateCommand(
        {
          map: join(root, 's', 'approved.yaml'),
          plan: join(root, 's', 'plan.yaml'),
          out: join(root, 's', 'generated'),
          force: true,
          states: join(root, 'estate', 'live', 'states', 'library.json'),
        },
        by.io,
      ),
    ];
    // After the scan: approve, map, plan and plan approve exit 0, and generate exits 1 for its incomplete tests.
    expect(steps.slice(1)).toEqual([0, 0, 0, 0, 1]);

    const single = await hashes(join(root, 's'));
    const chained = await hashes(join(root, 'b'), ['build.json']);
    // The report names the folder it was written into, so it is compared by its names, not its bytes.
    const comparable = (all: Record<string, string>) => {
      const rows = Object.entries(all).filter(([name]) => !name.endsWith('estate-generate-report.json'));
      return Object.fromEntries(rows);
    };
    expect(Object.keys(chained).sort()).toEqual(Object.keys(single).sort());
    expect(comparable(chained)).toEqual(comparable(single));
  }, 180_000);

  it('stops at the first approval outside a terminal and approves nothing', async () => {
    const root = await workspace();
    const built = await build(root, {});
    expect(built.code).toBe(1);
    expect(built.out).toContain('Stopped before the first approval:');
    expect(built.out).toContain('Run again with --yes to approve them all');
    expect(built.out).toContain('driftbench estate approve b/map.yaml --kind <kind>');
    const written = await hashes(join(root, 'b'), ['build.json']);
    expect(Object.keys(written)).toEqual(['map.yaml']);
  }, 120_000);

  it('asks before each approval on a terminal and stops when the answer is no', async () => {
    const root = await workspace();
    const declined = await build(root, {}, [false]);
    expect(declined.code).toBe(1);
    expect(declined.questions).toHaveLength(1);
    const atoms = /atoms were split from prose by a model and wait for your approval\. Approve all \d+\?/;
    expect(declined.questions[0]).toMatch(atoms);
    expect(Object.keys(await hashes(join(root, 'b'), ['build.json']))).toEqual(['map.yaml']);

    const first = await build(root, {}, [true, false]);
    expect(first.code).toBe(1);
    expect(first.questions).toHaveLength(2);
    const rows = /^The plan holds \d+ tests, \d+ of them waiting for your approval\. Approve all \d+\?/;
    expect(first.questions[1]).toMatch(rows);
    expect(first.out).toContain('Stopped: no test approved.');
    const names = Object.keys(await hashes(join(root, 'b'), ['build.json']));
    expect(names).toContain('approved.yaml');
    expect(names).toContain('plan.yaml');
    expect(names.some((name) => name.startsWith('generated'))).toBe(false);

    const rest = await build(root, {}, [true]);
    expect(rest.questions).toHaveLength(1);
    expect(rest.code).toBe(1);
    expect(rest.out).toContain('2. Approve the atoms: done before');
    expect(rest.out).toContain('5. Write the tests:');
  }, 240_000);

  it('skips a stage whose inputs did not change, and runs it again when they do', async () => {
    const root = await workspace();
    const once = await build(root, { yes: true });
    const before = await hashes(join(root, 'b'));
    const again = await build(root, { yes: true });
    expect(again.code).toBe(once.code);
    expect(again.out).toContain('1. Read the estate: unchanged');
    expect(again.out).toContain('2. Approve the atoms: done before');
    expect(again.out).toContain('3. Map and plan: unchanged');
    expect(again.out).toContain('4. Approve the plan: every test was approved before.');
    expect(again.out).toContain('5. Write the tests: unchanged');
    expect(await hashes(join(root, 'b'))).toEqual(before);

    const standing = join(root, 'estate', 'CLAUDE.md');
    await writeFile(standing, `${await readFile(standing, 'utf8')}\n- **R18.** Say hello first.\n`);
    const edited = await build(root, { yes: true });
    expect(edited.out).not.toContain('1. Read the estate: unchanged');
    expect(edited.out).toContain('1. Read the estate:');
    expect(edited.out).toContain('5. Write the tests:');
    expect(edited.out).not.toContain('5. Write the tests: unchanged');
  }, 240_000);

  it('keeps the scan warning on a re-run and re-reads the scan when the label sets change', async () => {
    const root = await workspace();
    const labels = join(root, 'labels.yaml');
    await writeFile(labels, pointer.AGENT_RULES_SET);
    const pointed: BuildOptions = {
      yes: true,
      pointer: true,
      cassette: 'estate/cassette.jsonl',
      labels: 'labels.yaml',
    };
    const warning = 'The scan reported some refused labels or failed chunks';
    const first = await build(root, pointed);
    expect(first.out).toContain('1. Read the estate:');
    expect(first.out).toContain(warning);
    const again = await build(root, pointed);
    expect(again.out).toContain('1. Read the estate: unchanged');
    expect(again.out).toContain(warning);
    await writeFile(labels, `${pointer.AGENT_RULES_SET}\n# an edit of the label sets\n`);
    const edited = await build(root, pointed);
    expect(edited.out).not.toContain('1. Read the estate: unchanged');
  }, 240_000);

  it('stops with exit 2 when the scan cannot read its replay file', async () => {
    const root = await workspace();
    const built = await build(root, { yes: true, replay: 'estate/missing.yaml' });
    expect(built.code).toBe(2);
    expect(built.out).not.toContain('2. Approve the atoms');
  }, 120_000);

  it('exits 2 for a folder that is not there', async () => {
    const root = await workspace();
    const seen = capture(root);
    const code = await estateBuildCommand('missing', { out: 'b' }, seen.io, { interactive: false });
    expect(code).toBe(2);
    expect(seen.err()).toContain('Cannot find missing.');
  });
});
