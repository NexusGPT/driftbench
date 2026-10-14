import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { faultAdapter, importFaultSet } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CampaignDeps, defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type CiSummary, registerCiCommand } from '../src/commands/ci';
import type { Io } from '../src/index';

/**
 * The safety net of the blast radius, end to end on the 171 Acme sales conversations, with no model
 * call: the audit sample, the verdict radius-miss, and the staleness limits.
 */

vi.setConfig({ testTimeout: 120_000 });

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GATED = join(ROOT, 'examples/acme/gated/specs');
/** The conversations of the gated suite: every folder but the price-sheet tasks. */
const SPECS = ['boundary', 'cover', 'deviation', 'graph', 'metamorphic', 'twise'].map((name) =>
  join(GATED, name),
);
const FAULTS = join(ROOT, 'examples/acme/faults/index.ts');
const manifest = (name: string) => join(ROOT, 'examples/acme/radius', `${name}.yaml`);

let dir = '';
let store = '';

/** One driftbench command, with the sales assistant replaced by a planted fault when one is named. */
async function cli(argv: string[], fault?: string) {
  const io = { out: '', err: '' };
  const handle: Io = {
    out: (text) => {
      io.out += text;
    },
    err: (text) => {
      io.err += text;
    },
    cwd: dir,
  };
  const defs = fault === undefined ? [] : (await importFaultSet(FAULTS)).faults;
  const deps: CampaignDeps = {
    ...defaultDeps,
    adapterFor: async (target, scope) => {
      const def = target.adapter === 'function' ? defs.find((each) => each.id === fault) : undefined;
      const adapter = await defaultDeps.adapterFor(target, scope);
      if (!adapter) throw new Error('missing fixture adapter');
      // This fixture changes the agent (the explicit v1 -> v2), not its function transport.
      // faultAdapter's diagnostic version otherwise introduces a second, correctly refused change.
      return def ? { ...faultAdapter(def, () => localProvider({})), version: adapter.version } : adapter;
    },
  };
  let code = 0;
  const setExit = (exit: number) => {
    code = exit;
  };
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: handle.out, writeErr: handle.err });
  registerCampaignCommands(program, handle, setExit, deps);
  registerCiCommand(program, handle, setExit, deps);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: 2, ...io };
    throw cause;
  }
  return { code, ...io };
}

const run = (id: string, version: string, extra: string[] = []) => [
  'campaign',
  'run',
  ...SPECS,
  '--target',
  'function:acme-sales',
  '--agent-version',
  version,
  '--campaign',
  id,
  '--store',
  store,
  '--no-cache',
  '--concurrency',
  '2',
  ...extra,
];

async function runsOf(campaignId: string): Promise<RunResult[]> {
  const db = openStore(store);
  try {
    return await db.listRuns({ campaignId });
  } finally {
    db.close();
  }
}

const carriedOf = (runs: readonly RunResult[]) => runs.filter((each) => each.carried !== undefined);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-audit-'));
  store = join(dir, 'runs.db');
  const baseline = await cli(run('c-base', 'acme-v1'));
  expect(baseline.err).toBe('');
  expect(baseline.code).toBe(0);
}, 600_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('--audit: a sample of the cells about to be carried runs fresh', () => {
  it('an unchanged agent reproduces every audited cell, and the output states the bound', async () => {
    // The identity control: the agent is the same, the manifest names a small change.
    const out = await cli(
      run('c-control', 'acme-v2', [
        '--change',
        manifest('deviation-goal-shift'),
        '--from',
        'c-base',
        '--audit',
        '59',
      ]),
    );
    expect(out.err).toBe('');
    expect(out.code).toBe(0);
    expect(out.out).toContain(
      'Audit: 59 cells drawn from the 162 outside the radius (seed 1) and run fresh: 0 misses. At 95% confidence, under 5.0% of the carried cells would disagree.',
    );
    const runs = await runsOf('c-control');
    // 9 cells in the radius and 59 audited run fresh; the other 103 are carried.
    expect([runs.length, carriedOf(runs).length]).toEqual([171, 103]);
    expect(out.out).toContain('59 cells outside the radius run fresh: drawn for the audit.');
  });

  it('a manifest that leaves out part of the change is caught: radius miss, nothing carried, exit 1', async () => {
    // The agent orders on a loose yes at the recap. The manifest names the D4 handler alone.
    await writeFile(
      join(dir, 'd4-only.yaml'),
      'from: acme-v1\nto: acme-v2\nchanges:\n  - kind: deviation\n    id: D4\n',
    );
    const out = await cli(
      run('c-miss', 'acme-v2', ['--change', join(dir, 'd4-only.yaml'), '--from', 'c-base', '--audit', '20']),
      'd4-order-on-loose-yes',
    );
    expect(out.err).toBe('');
    await writeFile(
      join(dir, 'radius-audit.txt'),
      out.out
        .split('\n')
        .filter((line) => !line.startsWith('✓') && !line.startsWith('✗'))
        .join('\n'),
    );
    expect(out.out).toContain(
      'RADIUS MISS: the change reaches cells the manifest left out of the radius. The gate fails closed.',
    );
    expect(out.out).toMatch(
      /Nothing is carried, every cell runs: the audit found \d+ of 20 carried results the new agent does not reproduce\./,
    );
    expect(out.code).toBe(1);
    const runs = await runsOf('c-miss');
    expect([runs.length, carriedOf(runs).length]).toEqual([171, 0]);
    // Failing closed is what makes the result right: the whole suite ran, and it fails where the fault bites.
    expect(out.out).toContain('171 cells: 146 pass, 25 fail, 0 failed, 20 reused.');
  });

  it('draws the audited cells with --audit-seed: the same seed the same cells, another seed other cells', async () => {
    const audited = async (id: string, seed: string[]) => {
      const out = await cli(
        run(id, 'acme-v2', [
          '--change',
          manifest('deviation-goal-shift'),
          '--from',
          'c-base',
          '--audit',
          '5',
          ...seed,
        ]),
      );
      expect(out.err).toBe('');
      expect(out.code).toBe(0);
      const fresh = (await runsOf(id)).filter((each) => each.carried === undefined);
      // 9 cells in the radius and 5 audited run fresh.
      expect(fresh).toHaveLength(14);
      return {
        out: out.out,
        cells: fresh.map((each) => `${each.specId} ${each.mode} ${each.repeat}`).sort(),
      };
    };
    const one = await audited('c-seed-default', []);
    expect(one.out).toContain('(seed 1)');
    const same = await audited('c-seed-1', ['--audit-seed', '1']);
    expect(same.cells).toEqual(one.cells);
    const other = await audited('c-seed-2', ['--audit-seed', '2']);
    expect(other.out).toContain('(seed 2)');
    expect(other.cells).not.toEqual(one.cells);

    const alone = await cli(
      run('c-bad-seed', 'acme-v2', [
        '--change',
        manifest('deviation-goal-shift'),
        '--from',
        'c-base',
        '--audit-seed',
        '2',
      ]),
    );
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('--audit-seed sets the draw of an audit: it goes with --audit <n>.');
  });

  it('refuses the audit flags without --change, and a size that is not a whole number', async () => {
    expect((await cli(run('c-bad', 'acme-v2', ['--audit', '5']))).code).toBe(2);
    expect((await cli(run('c-bad', 'acme-v2', ['--max-carry', '2']))).code).toBe(2);
    const half = await cli(
      run('c-bad', 'acme-v2', [
        '--change',
        manifest('deviation-goal-shift'),
        '--from',
        'c-base',
        '--audit',
        '2.5',
      ]),
    );
    expect(half.code).toBe(2);
    expect(half.err).toContain('--audit takes a whole number of at least 1');
    expect(await runsOf('c-bad')).toEqual([]);
  });
});

describe('staleness: a carried result does not stay carried for ever', () => {
  const small = (id: string, version: string, extra: string[]) => {
    const argv = run(id, version, extra);
    // The conversations of two folders: 20 cells.
    argv.splice(2, SPECS.length, join(GATED, 'graph'), join(GATED, 'deviation'));
    return argv;
  };

  it('--max-carry brings a result carried once back into the run on the next radius campaign', async () => {
    const change = manifest('tool-coverage-check-input');
    const first = await cli(small('c-r1', 'acme-v2', ['--change', change, '--from', 'c-base']));
    expect(first.err).toBe('');
    const r1 = await runsOf('c-r1');
    const carriedOnce = new Set(carriedOf(r1).map((each) => each.specId));
    expect(carriedOnce.size).toBeGreaterThan(0);
    expect(carriedOnce.size).toBeLessThan(r1.length);

    // The next version, same change. Its baseline is the radius campaign before it.
    const next = (await readFile(change, 'utf8'))
      .replace('acme-v1', 'acme-v2')
      .replace('to: acme-v2', 'to: acme-v3');
    await writeFile(join(dir, 'v3.yaml'), next);
    const limited = await cli(
      small('c-r2-limit', 'acme-v3', [
        '--change',
        join(dir, 'v3.yaml'),
        '--from',
        'c-r1',
        '--max-carry',
        '1',
      ]),
    );
    expect(limited.out).toContain(
      `${carriedOnce.size} cells outside the radius run fresh: carried 1 campaigns in a row, the limit is 1.`,
    );
    expect(carriedOf(await runsOf('c-r2-limit'))).toEqual([]);

    // With the default limit the same results are carried again, and their age says so.
    const again = await cli(small('c-r2', 'acme-v3', ['--change', join(dir, 'v3.yaml'), '--from', 'c-r1']));
    expect(again.err).toBe('');
    const r2 = carriedOf(await runsOf('c-r2'));
    expect(new Set(r2.map((each) => each.specId))).toEqual(carriedOnce);
    for (const each of r2) {
      // Still stamped with the campaign that measured it and the version it was measured on.
      expect(each.carried).toMatchObject({
        fromCampaign: 'c-base',
        agentVersion: 'acme-v1',
        age: { campaigns: 2 },
      });
    }
    expect(again.out).toMatch(/carried from c-base, age 2 campaigns/);
  });

  it('--max-age 0 carries nothing older than the campaign itself: a full run', async () => {
    const out = await cli(
      small('c-fresh', 'acme-v2', [
        '--change',
        manifest('tool-coverage-check-input'),
        '--from',
        'c-base',
        '--max-age',
        '0',
      ]),
    );
    expect(out.out).toMatch(
      /cells outside the radius run fresh: its fresh run is 0 days old, the limit is 0\./,
    );
    expect(carriedOf(await runsOf('c-fresh'))).toEqual([]);
  });

  it('a campaign with no --change carries nothing: the full run resets every age', async () => {
    const out = await cli(small('c-nightly', 'acme-v3', []));
    expect(out.out).not.toContain('carried');
    expect(carriedOf(await runsOf('c-nightly'))).toEqual([]);
  });
});

describe('ci --change', () => {
  const ci = (extra: string[], out: string) => [
    'ci',
    '--specs',
    join(GATED, 'twise'),
    '--target',
    'function:acme-sales',
    '--baseline',
    'c-base',
    '--store',
    store,
    '--agent-version',
    'acme-v2',
    '--concurrency',
    '2',
    '--out',
    out,
    ...extra,
  ];
  const summaryOf = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8')) as CiSummary;

  it('runs the radius, carries the rest, pairs the fresh goldens only and reports the blocks sent', async () => {
    const out = await cli(ci(['--change', manifest('stage-recap'), '--audit', '10'], 'radius.json'));
    expect(out.err).toBe('');
    const summary = await summaryOf('radius.json');
    const radius = summary.radius;
    if (!radius) throw new Error('the summary holds no radius block');
    expect(radius.fresh + radius.carried).toBe(summary.candidate.cells);
    expect(radius.carried).toBeGreaterThan(0);
    expect(radius.audit).toMatchObject({ sampled: 10, misses: 0, seed: 1, missed: [] });
    expect(summary.pairs).toBe(radius.fresh);
    // The baseline holds more goldens than this run asks for: those are baseline only. Every carried one is listed.
    const carried = summary.unpaired.filter((entry) =>
      entry.reason.startsWith('carried from c-base, agent version acme-v1'),
    );
    expect(carried).toHaveLength(radius.carried);
    expect(summary.unpaired.filter((entry) => !carried.includes(entry)).map((entry) => entry.reason)).toEqual(
      summary.unpaired.filter((entry) => !carried.includes(entry)).map(() => 'baseline only'),
    );
    expect(radius.blocks.sent).toBeGreaterThan(0);
    expect(radius.blocks.carried).toBeGreaterThan(0);
    expect(summary.verdict).not.toBe('radius-miss');
    expect(out.out).toContain(
      `${radius.fresh} cells run fresh, ${radius.carried} carried from c-base: ${radius.blocks.sent} of ${radius.blocks.sent + radius.blocks.carried} blocks sent`,
    );
    expect(out.out).toContain('Audit: 10 cells outside the radius run fresh (seed 1), 0 misses.');
  });

  it('gives the verdict radius-miss and exits 1 when the audit finds what the manifest left out', async () => {
    const out = await cli(
      ci(['--change', join(dir, 'd4-only.yaml'), '--audit', '20'], 'miss.json'),
      'd4-order-on-loose-yes',
    );
    const summary = await summaryOf('miss.json');
    expect(summary.verdict).toBe('radius-miss');
    expect(summary.exitCode).toBe(1);
    expect(out.code).toBe(1);
    expect(summary.radius?.carried).toBe(0);
    expect(summary.radius?.audit?.misses).toBeGreaterThan(0);
    expect(summary.reasons[0]).toMatch(
      /^the audit ran 20 cells outside the radius and \d+ did not reproduce the carried result/,
    );
    expect(out.out).toContain('RADIUS MISS');
    // Nothing was carried, so every golden is paired: the comparison is over the whole suite.
    expect(summary.pairs).toBe(summary.candidate.cells);
  });

  it('without --change the summary holds no radius block', async () => {
    const out = await cli(ci([], 'plain.json'));
    expect(out.err).toBe('');
    const summary = await summaryOf('plain.json');
    expect('radius' in summary).toBe(false);
    expect(summary.pairs).toBe(summary.candidate.cells);
    expect(out.out).not.toContain('Blast radius');
  });
});
