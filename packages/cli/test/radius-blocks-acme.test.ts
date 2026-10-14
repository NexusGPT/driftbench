import { mkdtemp, rm } from 'node:fs/promises';
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
import type { Io } from '../src/index';

/**
 * Mode T block reruns on the Acme gated suite, with no model call. A baseline T campaign runs the real
 * agents as acme-v1. The sales assistant then suffers a planted fault (it drops the coverage check) and
 * becomes acme-v2. A block-rerun campaign sends only the blocks the change can affect; a full T campaign of
 * the same faulty agent shows the rule missed no failing block.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SPECS = join(ROOT, 'examples/acme/gated/specs');
const FAULTS = join(ROOT, 'examples/acme/faults/index.ts');
const MANIFEST = join(ROOT, 'examples/acme/radius/tool-coverage-check-input.yaml');

vi.setConfig({ testTimeout: 300_000 });

let dir = '';
let store = '';

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
      // The fixture changes the agent (the explicit v1 to v2), not its function transport.
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

const run = (id: string, version: string, extra: string[] = []) => [
  'campaign',
  'run',
  SPECS,
  '--target',
  'function:acme-sales',
  '--route',
  'flow:price-sheet=process:acme-ops',
  '--mode',
  'T',
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

/** The blocks that reached the agent and the failing ones, keyed by spec and block index. */
const sent = (runs: readonly RunResult[]) =>
  runs.flatMap((r) => r.blocks.filter((b) => !b.carried && !r.carried).map((b) => `${r.specId}#${b.index}`));
const red = (runs: readonly RunResult[]) =>
  runs.flatMap((r) => r.blocks.filter((b) => !b.pass).map((b) => `${r.specId}#${b.index}`)).sort();

let baseline: Awaited<ReturnType<typeof campaign>>;
let rerun: Awaited<ReturnType<typeof campaign>>;
let full: Awaited<ReturnType<typeof campaign>>;
let plain: Awaited<ReturnType<typeof campaign>>;
let fallback: Awaited<ReturnType<typeof campaign>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-blocks-acme-'));
  store = join(dir, 'runs.db');
  baseline = await campaign(run('t-base', 'acme-v1', ['--record-end-state-snapshots']));
  plain = await campaign(run('t-plain', 'acme-v1'));
  rerun = await campaign(
    run('t-rerun', 'acme-v2', ['--change', MANIFEST, '--from', 't-base', '--block-reruns']),
    'x5-drops-coverage-check',
  );
  fallback = await campaign(
    run('t-fallback', 'acme-v2', ['--change', MANIFEST, '--from', 't-plain', '--block-reruns']),
    'x5-drops-coverage-check',
  );
  full = await campaign(run('t-full', 'acme-v2'), 'x5-drops-coverage-check');
}, 900_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let audited: Awaited<ReturnType<typeof campaign>>;
let wrong: Awaited<ReturnType<typeof campaign>>;
beforeAll(async () => {
  // The test can fail: the recap manifest does not name this fault, so the rule leaves its blocks out.
  wrong = await campaign(
    run('t-wrong', 'acme-v2', [
      '--change',
      join(ROOT, 'examples/acme/radius/stage-recap.yaml'),
      '--from',
      't-base',
      '--block-reruns',
    ]),
    'x5-drops-coverage-check',
  );
  // The right fault with a manifest that leaves part of the change out: the offer prices are not in its radius.
  audited = await campaign(
    run('t-audit', 'acme-v2', ['--change', MANIFEST, '--from', 't-base', '--block-reruns', '--audit', '195']),
    'x1-invents-price',
  );
}, 900_000);

describe('mode T block reruns on the Acme gated suite', () => {
  it('sends the 86 blocks of the coverage check input with snapshots, and 376 without', async () => {
    for (const result of [baseline, plain, rerun, fallback, full]) expect(result.err).toBe('');
    const [withSnapshots, without, all] = await Promise.all([
      runsOf('t-rerun'),
      runsOf('t-fallback'),
      runsOf('t-full'),
    ]);
    expect([sent(withSnapshots).length, sent(without).length, sent(all).length]).toEqual([86, 376, 867]);
    expect(rerun.out).toContain(
      'Mode T block reruns: 86 cells send 86 blocks and keep 330 stored blocks from t-base.',
    );
    expect(rerun.out).toContain('Saved: 781 of 867 blocks, 90.1%.');
    expect(fallback.out).toContain('65 cells run whole: end state cannot be recomposed: full cell rerun.');
  });

  it('misses no failing block: the merged result fails on exactly the blocks of the full run', async () => {
    const all = red(await runsOf('t-full'));
    expect(all).toHaveLength(86);
    expect(red(await runsOf('t-rerun'))).toEqual(all);
    expect(red(await runsOf('t-fallback'))).toEqual(all);
    // Every failing block of the full run was sent to the agent, none was a kept stored block.
    const sentKeys = new Set(sent(await runsOf('t-rerun')));
    expect(all.filter((key) => !sentKeys.has(key))).toEqual([]);
    expect(rerun.code).toBe(full.code);
    expect(red(await runsOf('t-base'))).toEqual([]);
  });

  it('stores raw end-state values only when the baseline campaign opts in', async () => {
    const stamped = (runs: readonly RunResult[]) =>
      runs.filter((r) => r.blocks.some((b) => b.provenance?.endState));
    expect(stamped(await runsOf('t-plain'))).toEqual([]);
    expect(stamped(await runsOf('t-base')).length).toBeGreaterThan(0);
    const db = openStore(store);
    try {
      expect((await db.getCampaign('t-base'))?.provenance?.endStateSnapshots).toBe(true);
      expect((await db.getCampaign('t-plain'))?.provenance?.endStateSnapshots).toBeUndefined();
      // A block rerun of a snapshot baseline keeps recording them.
      expect((await db.getCampaign('t-rerun'))?.provenance?.endStateSnapshots).toBe(true);
    } finally {
      db.close();
    }
  });

  it('shows the check can fail: a manifest that leaves the fault out keeps failing blocks unsent', async () => {
    expect(wrong.err).toBe('');
    const sentKeys = new Set(sent(await runsOf('t-wrong')));
    const missed = red(await runsOf('t-full')).filter((key) => !sentKeys.has(key));
    expect(missed.length).toBeGreaterThan(0);
  });

  it('catches the unsent failing blocks of a wrong declaration with the audit', async () => {
    const result = await campaign(
      run('t-wrong-audit', 'acme-v2', [
        '--change',
        join(ROOT, 'examples/acme/radius/stage-recap.yaml'),
        '--from',
        't-base',
        '--block-reruns',
        '--audit',
        '195',
      ]),
      'x5-drops-coverage-check',
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    expect(result.out).toContain('RADIUS MISS');
  });

  it('catches a planted fault outside the radius with the audit and fails closed', async () => {
    expect(audited.err).toBe('');
    expect(audited.code).toBe(1);
    expect(audited.out).toContain('RADIUS MISS');
    expect(sent(await runsOf('t-audit')).length).toBe(867);
  });
});
