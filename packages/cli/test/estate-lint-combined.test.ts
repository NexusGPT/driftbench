import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFORMATION } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { lintMap } from '../src/commands/estate';
import { estateBuildCommand } from '../src/commands/estate-build';
import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

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

type LintJson = {
  failed: boolean;
  notRun: boolean;
  totals: Array<{ code: string; total: number; shown: number; omitted: number }>;
  findings: Array<{ code: string }>;
};

async function cli(argv: string[], cwd: string) {
  const seen = capture(cwd);
  const code = await main(argv, seen.io);
  return { code, out: seen.out(), err: seen.err() };
}

/** A folder holding a copy of the fixture estate, built by `estate build`, which runs the lint of its map. */
async function built(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-lint-combined-'));
  await cp(FIXTURE, join(root, 'estate'), { recursive: true });
  await rm(join(root, 'estate', 'generated'), { recursive: true, force: true });
  const seen = capture(root);
  await estateBuildCommand(
    'estate',
    {
      out: 'b',
      yes: true,
      replay: 'estate/answers.yaml',
      states: join(root, 'estate', 'live', 'states', 'library.json'),
    },
    seen.io,
    { now: () => new Date('2026-01-01T00:00:00Z'), interactive: false },
  );
  expect(seen.err()).toBe('');
  return root;
}

describe('the lint path that estate build and estate lint share', () => {
  it('gives the same findings to the build, the printed report and the data, and cuts only what is listed', async () => {
    const root = await built();
    const run = await lintMap(join(root, 'b', 'approved.yaml'), {}, capture(root).io);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const failing = run.result.findings.filter((finding) => !INFORMATION.has(finding.code));
    expect(failing.length).toBeGreaterThan(0);

    const cut = JSON.parse(
      (await cli(['estate', 'lint', 'b/approved.yaml', '--json'], root)).out,
    ) as LintJson;
    const all = JSON.parse(
      (await cli(['estate', 'lint', 'b/approved.yaml', '--json', '--verbose'], root)).out,
    ) as LintJson;
    // The true total of every code is what the build counted, whatever the report lists.
    const total = (data: LintJson) => data.totals.reduce((sum, entry) => sum + entry.total, 0);
    expect(total(cut)).toBe(failing.length);
    expect(total(all)).toBe(failing.length);
    for (const entry of cut.totals) {
      expect(entry.shown).toBe(Math.min(entry.total, 10));
      expect(entry.shown + entry.omitted).toBe(entry.total);
    }
    expect(all.totals.every((entry) => entry.omitted === 0)).toBe(true);
    expect(all.findings).toHaveLength(failing.length);
    expect(cut.failed).toBe(true);
    expect(cut.notRun).toBe(false);
  });

  it('refuses the map of a build moved away from its estate, in the build path and the command, with a fix', async () => {
    const root = await built();
    await mkdir(join(root, 'away'));
    await cp(join(root, 'b'), join(root, 'away', 'b'), { recursive: true });
    const seen = capture(root);
    const run = await lintMap(join(root, 'away', 'b', 'approved.yaml'), {}, seen.io);
    expect(run).toEqual({ ok: false, code: 2 });
    expect(seen.err()).toMatch(/Cannot find the estate folder/);
    expect(seen.err()).toMatch(/Fix: /);
    const command = await cli(['estate', 'lint', 'away/b/approved.yaml', '--json'], root);
    expect(command.code).toBe(2);
    expect(command.out).toBe('');
    expect(command.err).toMatch(/Fix: /);
  });
});
