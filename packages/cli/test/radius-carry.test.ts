import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentVersionOf, type RunResult } from '@agent-nexus/driftbench-core';
import { faultAdapter, importFaultSet } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CampaignDeps, defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type Io, main } from '../src/index';

/**
 * The blast radius end to end on the Acme gated suite, with no model call. A baseline campaign runs the
 * real agents as version acme-v1. The agent then suffers a planted fault (it skips the recap) and becomes
 * acme-v2. A radius campaign runs the cells the recap change can affect and carries the rest; a full
 * campaign of the same faulty agent shows the radius missed nothing.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SPECS = join(ROOT, 'examples/acme/gated/specs');
const FAULTS = join(ROOT, 'examples/acme/faults/index.ts');
/** Ten conversations of the suite, for the cases that need no full run. */
const GRAPH = join(SPECS, 'graph');
const manifest = (name: string) => join(ROOT, 'examples/acme/radius', `${name}.yaml`);

// Each case reads or runs campaigns of up to 195 cells.
vi.setConfig({ testTimeout: 120_000 });

let dir = '';
let store = '';

/** `campaign` with the sales assistant replaced by a planted fault, when one is named. */
async function campaign(argv: string[], fault?: string) {
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
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: handle.out, writeErr: handle.err });
  registerCampaignCommands(
    program,
    handle,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: 2, ...io };
    throw cause;
  }
  return { code, ...io };
}

const run = (id: string, version: string, extra: string[] = [], specs = SPECS) => [
  'campaign',
  'run',
  specs,
  '--target',
  'function:acme-sales',
  '--route',
  'flow:price-sheet=process:acme-ops',
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

const failed = (runs: readonly RunResult[]) =>
  runs
    .filter(
      (each) =>
        each.status !== 'completed' ||
        each.blocks.some((block) => !block.pass) ||
        each.endState?.match === false,
    )
    .map((each) => each.specId)
    .sort();
const blocks = (runs: readonly RunResult[]) => runs.reduce((sum, each) => sum + each.blocks.length, 0);

let baseline: Awaited<ReturnType<typeof campaign>>;
let radius: Awaited<ReturnType<typeof campaign>>;
let full: Awaited<ReturnType<typeof campaign>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-carry-'));
  store = join(dir, 'runs.db');
  baseline = await campaign(run('c-base', 'acme-v1'));
  radius = await campaign(
    run('c-radius', 'acme-v2', ['--change', manifest('stage-recap'), '--from', 'c-base']),
    'x3-skips-recap',
  );
  full = await campaign(run('c-full', 'acme-v2'), 'x3-skips-recap');
}, 600_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('campaign run --change --from on the Acme gated suite', () => {
  it('runs only the radius and carries the stored run of every other cell', async () => {
    expect(baseline.err).toBe('');
    expect(radius.err).toBe('');
    expect(radius.out).toContain(
      'Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.\n102 of 195 cells in the radius. 102 cells run fresh, 93 carried from c-base.\n',
    );
    const runs = await runsOf('c-radius');
    const fresh = runs.filter((each) => each.carried === undefined);
    const carried = runs.filter((each) => each.carried !== undefined);
    expect([fresh.length, carried.length]).toEqual([102, 93]);
    // What reached the agent, against the whole suite: the measured saving.
    const all = await runsOf('c-full');
    expect(all).toHaveLength(195);
    expect(blocks(fresh)).toBeLessThan(blocks(all));
    // Measured on this run: 606 of 867 blocks reach the agent, 261 are carried, 30.1% saved.
    expect([blocks(fresh), blocks(carried), blocks(all)]).toEqual([606, 261, 867]);
    expect(radius.out).toContain('Saved: 261 of 867 blocks, 30.1%.');
    expect(radius.out).toContain(
      `Fresh: 102 cells, ${blocks(fresh)} blocks sent to the agent. Carried from c-base: 93 cells, ${blocks(carried)} blocks not sent (agent version acme-v1; this campaign runs acme-v2).`,
    );
    expect(radius.out).toContain('The pass and fail counts above merge fresh and carried results.');
    expect(radius.out).toMatch(/195 cells: \d+ pass, \d+ fail, 0 failed, 93 carried\. /);
  });

  it('stamps every carried run with the campaign, the run and the agent version it comes from', async () => {
    const runs = await runsOf('c-radius');
    const base = new Map((await runsOf('c-base')).map((each) => [each.specId, each]));
    for (const each of runs) {
      // Every run of the campaign carries this campaign's target: the cell ids are its own.
      expect(agentVersionOf(each)).toBe('acme-v2');
      if (each.carried === undefined) continue;
      const source = base.get(each.specId);
      expect(each.carried).toEqual({
        fromCampaign: 'c-base',
        fromRun: source?.runId,
        agentVersion: 'acme-v1',
        age: { campaigns: 1, days: each.carried.age.days },
      });
      expect(each.carried.age.days).toBeLessThan(1);
      expect(each.blocks).toEqual(source?.blocks);
      expect(each.runId).not.toBe(source?.runId);
    }
  });

  it('catches the planted fault inside the radius: the full suite finds no failure the radius missed', async () => {
    const all = await runsOf('c-full');
    const part = await runsOf('c-radius');
    // The fault is real: the full suite of the faulty agent fails where the baseline did not.
    expect(failed(await runsOf('c-base'))).toEqual([]);
    expect(failed(all)).toHaveLength(102);
    // The merged radius campaign fails on exactly the cells the full suite fails on.
    expect(failed(part)).toEqual(failed(all));
    // And none of those failures is a carried result the fault would have changed.
    const carried = new Set(part.filter((each) => each.carried !== undefined).map((each) => each.specId));
    const base = new Set(failed(await runsOf('c-base')));
    expect(failed(all).filter((id) => carried.has(id) && !base.has(id))).toEqual([]);
    expect(radius.code).toBe(full.code);
  });

  it('marks the carried cells in the cell lines, in status, and reruns nothing on resume', async () => {
    expect(radius.out).toMatch(/pass \(carried from c-base, age 1 campaign\)/);
    const status = await main(['campaign', 'status', 'c-radius', '--store', store], {
      out: () => {},
      err: () => {},
      cwd: dir,
    });
    expect(status).toBe(radius.code);
    const resumed = await campaign(['campaign', 'resume', 'c-radius', '--store', store], 'x3-skips-recap');
    expect(resumed.err).toBe('');
    expect(await runsOf('c-radius')).toHaveLength(195);
    expect(resumed.out).toMatch(/93 carried/);
    expect(resumed.out).toMatch(/102 reused/);
  });
});

describe('fresh and carried in the statistics and the report', () => {
  const cli = async (argv: string[]) => {
    const io = { out: '', err: '' };
    const code = await main(argv, {
      out: (text) => {
        io.out += text;
      },
      err: (text) => {
        io.err += text;
      },
      cwd: dir,
    });
    return { code, ...io };
  };

  it('compare pairs the fresh cells only and lists every carried cell as not paired, with its source', async () => {
    const out = await cli([
      'compare',
      '--baseline',
      'c-base',
      '--candidate',
      'c-radius',
      '--store',
      store,
      '--json',
    ]);
    expect(out.err).toBe('');
    const result = JSON.parse(out.out) as {
      pairs: { unit: string }[];
      unpaired: { unit: string; reason: string }[];
      carried: {
        fresh: number;
        carried: number;
        versions: string[];
        sources: { campaign: string; agentVersion: string; runs: number }[];
      };
      allPass: { baseline: { k: number; n: number }; candidate: { k: number; n: number } };
    };
    expect(result.pairs).toHaveLength(102);
    expect(result.unpaired).toHaveLength(93);
    expect(new Set(result.unpaired.map((entry) => entry.reason))).toEqual(
      new Set(['carried from c-base, agent version acme-v1, age 1 campaign: not a new measurement']),
    );
    expect(result.carried).toMatchObject({
      fresh: 102,
      carried: 93,
      versions: ['acme-v2'],
      sources: [{ campaign: 'c-base', agentVersion: 'acme-v1', runs: 93 }],
    });
    // The rates of the paired test are over the 102 fresh cells: no carried cell pads the agreement.
    expect(result.allPass.baseline).toMatchObject({ k: 102, n: 102 });
    expect(result.allPass.candidate).toMatchObject({ k: 0, n: 102 });
    const text = await cli(['compare', '--baseline', 'c-base', '--candidate', 'c-radius', '--store', store]);
    expect(text.out).toContain('Paired: 102 goldens');
    expect(text.out).toContain(
      'Carried, not paired: 93 runs of the candidate are results copied from an earlier campaign. The tests above read the 102 fresh runs only.',
    );
    expect(text.out).toContain(
      '  93 runs carried from c-base, measured on another agent version, acme-v1 (this campaign runs acme-v2); oldest: 1 campaign,',
    );
  });

  it('compare of two full campaigns says nothing about carried results', async () => {
    const out = await cli([
      'compare',
      '--baseline',
      'c-base',
      '--candidate',
      'c-full',
      '--store',
      store,
      '--json',
    ]);
    const result = JSON.parse(out.out) as { pairs: unknown[]; unpaired: unknown[]; carried?: unknown };
    expect(result.pairs).toHaveLength(195);
    expect(result.unpaired).toEqual([]);
    expect('carried' in result).toBe(false);
  });

  it('the report says its rates merge fresh and carried results, and which agent version the carried ones ran', async () => {
    const out = await cli(['report', 'c-radius', '--store', store, '--out', 'radius.html']);
    expect(out.err).toBe('');
    expect(out.out).toContain('Campaign c-radius: 195 runs, 93 pass, 102 fail, 0 did not complete.');
    expect(out.out).toContain(
      'Fresh and carried results are merged: 102 runs fresh, 93 runs carried. Every rate over this campaign counts both.',
    );
    expect(out.out).toContain('measured on another agent version, acme-v1 (this campaign runs acme-v2)');
    const html = await readFile(join(dir, 'radius.html'), 'utf8');
    expect(html).toContain('Fresh and carried results are merged: 102 runs fresh, 93 runs carried.');
    expect(html).toContain('carried from c-base, agent version acme-v1, age 1 campaign');
    const plain = await cli(['report', 'c-full', '--store', store, '--out', 'full.html']);
    expect(plain.out).not.toContain('carried');
    expect(await readFile(join(dir, 'full.html'), 'utf8')).not.toContain('carried from');
  });
});

describe('carry is refused when the versions do not hold', () => {
  it('carries nothing when the campaign names no agent version, and says why', async () => {
    const argv = run('c-noversion', 'x', ['--change', manifest('stage-recap'), '--from', 'c-base'], GRAPH);
    argv.splice(argv.indexOf('--agent-version'), 2);
    const out = await campaign(argv);
    expect(out.out).toContain(
      'Nothing is carried, every cell runs: this campaign names no agent version: pass --agent-version, or pin a prompt with --prompt.',
    );
    expect((await runsOf('c-noversion')).filter((each) => each.carried !== undefined)).toEqual([]);
  });

  it('carries nothing when the manifest does not end at the version the campaign runs', async () => {
    const out = await campaign(
      run('c-other', 'acme-v9', ['--change', manifest('stage-recap'), '--from', 'c-base', '--json'], GRAPH),
    );
    const report = JSON.parse(out.out) as {
      radius: { fresh: number; carried: number; blocks: { carried: number } };
    };
    expect(report.radius).toMatchObject({ fresh: 10, carried: 0, blocks: { carried: 0 } });
  });

  it('exits 2 on --change without --from, --from without --change, or an unknown campaign', async () => {
    const base = run('c-bad', 'acme-v2', [], GRAPH);
    expect((await campaign([...base, '--change', manifest('stage-recap')])).code).toBe(2);
    expect((await campaign([...base, '--from', 'c-base'])).code).toBe(2);
    const unknown = await campaign([...base, '--change', manifest('stage-recap'), '--from', 'c-none']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('No campaign c-none');
    expect(await runsOf('c-bad')).toEqual([]);
  });
});
