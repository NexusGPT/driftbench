import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type Check,
} from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import {
  acmeAdapter,
  broken,
  dropsFirstToolCall,
  minimalChecks,
  pricedAcmeAdapter,
  realAcmeAdapter,
} from '../../core/test/runner/support';
import {
  acmeFunctionAdapter,
  type CampaignDeps,
  defaultDeps,
  registerCampaignCommands,
  showTarget,
} from '../src/commands/campaign';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPECS = 'examples/acme/specs/conversations';
const ACME = 'examples/acme/specs';
const TASK = 'examples/acme/specs/tasks/price-sheet.yaml';
/** The cells of the process target run a real code agent twice per cell: give them room. */
const SLOW = 120_000;

/** Folders the tests make, removed when the file is done. */
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI: through `main` with the interim build, or with the deps a test gives. */
async function cli(argv: string[], deps?: Partial<CampaignDeps>) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  if (!deps) return { code: await main(argv, io), out, err };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerCampaignCommands(
    program,
    io,
    (exit) => {
      code = exit;
    },
    { ...defaultDeps, ...deps },
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

async function storePath(): Promise<string> {
  return join(await tempFolder(), 'store.db');
}

async function tempFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-campaign-'));
  made.push(dir);
  return dir;
}

/** The real Acme sales assistant, failing for good on the porting spec. */
async function salesWithPortingDown(): Promise<AgentAdapter> {
  const adapter = await acmeFunctionAdapter();
  const send = adapter.send.bind(adapter);
  adapter.send = async (session, turn) => {
    if (JSON.stringify(turn.stimulus).includes('keep my phone number')) {
      throw new AgentFailure('the porting service is down');
    }
    return send(session, turn);
  };
  return adapter;
}

/** The Acme agent, failing for good on the porting spec. */
function portingDown() {
  const adapter = acmeAdapter();
  const send = adapter.send.bind(adapter);
  adapter.send = async (session, turn) => {
    if (JSON.stringify(turn.stimulus).includes('keep my phone number')) {
      throw new AgentFailure('the porting service is down');
    }
    return send(session, turn);
  };
  return adapter;
}

describe('driftbench campaign plan', () => {
  it('prints the cells, the projected cost and the minimum detectable effect', async () => {
    const { code, out } = await cli([
      'campaign',
      'plan',
      SPECS,
      '--target',
      'function:acme',
      '--repeats',
      '3',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Plan: 6 specs, 1 target, mode F, 3 repeats: 18 cells, 78 blocks.');
    expect(out).toMatch(/ {2}[0-9a-f]{16} {2}acme-plan-upgrade {14}function:acme {2}F {5}2 {7}5\n/);
    expect(out).toContain('Projected cost: $0.00 (function: no unit measured).');
    expect(out).toContain(
      'Minimum detectable effect, mode F: 41.2 points on a 50% pass rate, with 18 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).',
    );
  });

  it('prices the blocks from the units in the store and compares with the budget', async () => {
    const path = await storePath();
    const store = openStore(path);
    await store.putUnit({
      adapter: 'function',
      metric: 'block',
      usd: 0.01,
      measuredAt: '2026-10-11T00:00:00.000Z',
    });
    await store.close();
    const { code, out } = await cli([
      'campaign',
      'plan',
      SPECS,
      '--target',
      'function:acme',
      '--repeats',
      '3',
      '--store',
      path,
      '--budget-usd',
      '0.5',
      '--baseline-rate',
      '0.9',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Projected cost: $0.78 (function: 78 blocks at $0.01). Over the budget of $0.50.');
    expect(out).toContain('Minimum detectable effect, mode F: 41.7 points on a 90% pass rate');
  });

  it('counts a target named twice once', async () => {
    const { code, out } = await cli([
      'campaign',
      'plan',
      SPECS,
      '--target',
      'function:acme',
      '--target',
      'function:acme',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Plan: 6 specs, 1 target, mode F, 1 repeat: 6 cells, 26 blocks.');
  });

  it('prints one JSON document with --json', async () => {
    const { code, out } = await cli(['campaign', 'plan', SPECS, '--target', 'function:acme', '--json']);
    expect(code).toBe(0);
    const plan = JSON.parse(out) as {
      cells: unknown[];
      blocks: number;
      mde: Array<{ effect?: number; specs: number; rho: number }>;
    };
    expect(plan.cells).toHaveLength(6);
    expect(plan.blocks).toBe(26);
    // Six specs of one run each at a 50% baseline: no drop below the baseline is detectable.
    expect(plan.mde[0]).toMatchObject({ specs: 6, rho: 0 });
    expect(plan.mde[0]?.effect).toBeUndefined();
  });

  it('prints none detectable when no drop below the baseline can be seen', async () => {
    const { code, out } = await cli(['campaign', 'plan', SPECS, '--target', 'function:acme']);
    expect(code).toBe(0);
    expect(out).toContain('Minimum detectable effect, mode F: none detectable on a 50% pass rate');
  });

  it('takes the correlation of repeats with --rho and prints the design effect', async () => {
    const { code, out } = await cli([
      'campaign',
      'plan',
      SPECS,
      '--target',
      'function:acme',
      '--repeats',
      '5',
      '--baseline-rate',
      '0.9',
      '--rho',
      '0.3',
    ]);
    expect(code).toBe(0);
    // 6 specs x 5 repeats, design effect 1 + 4 x 0.3 = 2.2: 13.6 effective runs.
    expect(out).toContain('(rho 0.3, design effect 2.20;');
    expect(out).toMatch(/Minimum detectable effect, mode F: (\d+\.\d) points on a 90% pass rate/);
  });

  it.each([
    [['--target', 'function:acme', '--mode', 'X'], 'Unknown mode "X".'],
    [['--target', 'function:acme', '--mode', 'T,Q'], 'Unknown mode "Q".'],
    [
      ['--target', 'function:acme', '--repeats', '0'],
      '--repeats takes a whole number of at least 1, not "0".',
    ],
    [['--target', 'function:acme', '--baseline-rate', '1'], '--baseline-rate takes a number between 0 and 1'],
    [['--target', 'function:acme', '--rho', '1.5'], '--rho takes a number from 0 to 1, not "1.5".'],
    [['--target', 'function:'], '"function:" is not a target. Write <adapter> or <adapter>:<agent>'],
  ])('exits 2 on %j', async (options, message) => {
    const { code, err } = await cli(['campaign', 'plan', SPECS, ...options]);
    expect(code).toBe(2);
    expect(err).toContain(message);
  });
});

describe('driftbench campaign in mode T', () => {
  it('plans T and F cells from one --mode list, T first', async () => {
    const { code, out } = await cli([
      'campaign',
      'plan',
      SPECS,
      '--target',
      'function:acme',
      '--mode',
      'F,T',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Plan: 6 specs, 1 target, modes T, F, 1 repeat: 12 cells, 52 blocks.');
    expect(out).toContain('Minimum detectable effect, mode T:');
    expect(out).toContain('Minimum detectable effect, mode F:');
  });

  it('runs a teacher-forced campaign: every block of every spec passes with the Acme agent', async () => {
    const store = await storePath();
    const { code, out } = await cli([
      'campaign',
      'run',
      SPECS,
      '--target',
      'function:acme',
      '--mode',
      'T',
      '--store',
      store,
      '--campaign',
      'c-teacher',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks');
    expect(out).toContain('6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.');
    const opened = await openStore(store);
    const campaign = await opened.getCampaign('c-teacher');
    expect(campaign?.modes).toEqual(['T']);
    expect(campaign?.repeats).toEqual({ T: 1, F: 0, P: 0 });
    await opened.close();
  });
});

describe('driftbench campaign in mode P', () => {
  it('runs every perturbation of the Acme specs after their F cells, each with its recovery', async () => {
    const store = await storePath();
    const { code, out } = await cli([
      'campaign',
      'run',
      SPECS,
      '--target',
      'function:acme',
      '--mode',
      'P,F',
      '--store',
      store,
      '--campaign',
      'c-perturbed',
    ]);
    expect(code).toBe(0);
    expect(out).toContain(
      '✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks',
    );
    expect(out).toContain(
      '✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks',
    );
    expect(out).toContain('17 cells: 17 pass, 0 fail, 0 failed. Spent $0.00.');
    const opened = await openStore(store);
    const runs = await opened.listRuns({ campaignId: 'c-perturbed', mode: 'P' });
    expect(runs).toHaveLength(11);
    expect(runs.map((run) => run.recovery?.label)).toEqual(runs.map(() => 'immediate'));
    expect(runs.every((run) => run.recovery?.collateral === 0 && run.recovery.safeAction === true)).toBe(
      true,
    );
    await opened.close();
  });
});

describe('driftbench campaign status --detail', () => {
  /** Loses the thread once it has written three replies of its own: free-running runs drift after block 2. */
  const drifting = () =>
    realAcmeAdapter((agent) => ({
      async respond(messages, world) {
        const observed = await agent.respond(messages, world);
        const own = messages.filter((message) => message.role === 'assistant' && message.content !== '');
        if (own.length >= 3) {
          observed.text = 'Sorry, let me start again. What is your email address?';
          observed.segments = [{ type: 'text', text: observed.text }];
        }
        return observed;
      },
    }));

  it('prints the compounding index, the succession and the recovery of every run', async () => {
    const store = await storePath();
    const spec = 'examples/acme/specs/conversations/plan-upgrade.yaml';
    const deps = { adapterFor: async () => drifting() };
    const ran = await cli(
      [
        'campaign',
        'run',
        spec,
        '--target',
        'function:acme',
        '--mode',
        'T,F,P',
        '--store',
        store,
        '--campaign',
        'c-detail',
      ],
      deps,
    );
    expect(ran.code).toBe(1);
    const { code, out } = await cli(['campaign', 'status', 'c-detail', '--store', store, '--detail'], deps);
    expect(code).toBe(1);
    // Checked by hand: T passes all 5 blocks; F fails blocks 3 and 4 (the agent's own third reply on).
    expect(out).toContain(
      '  acme-plan-upgrade  function:acme  5       1/1       100.0%  60.0%  +40.0  [0.0, +80.0]',
    );
    expect(out).toContain('  all specs                         5                 100.0%  60.0%  +40.0\n');
    expect(out).toContain(
      '  acme-plan-upgrade  F     0                           5       3            2       40.0%  3              no        X1_local 2',
    );
    // billing-aside: the aside passes, then the recap (passed in F) fails: collateral 1.
    expect(out).toContain(
      '  acme-plan-upgrade  billing-aside       D9_out_of_scope        0       2            0      immediate  1           yes          yes',
    );
    // loose-ok: injected after three replies of its own, so it never comes back.
    expect(out).toContain(
      '  acme-plan-upgrade  loose-ok            D4_loose_confirmation  0       3            none   never      0           yes          yes',
    );
    const json = await cli(['campaign', 'status', 'c-detail', '--store', store, '--detail', '--json'], deps);
    const detail = (JSON.parse(json.out) as { detail: { compounding: { overall: { index: number } } } })
      .detail;
    expect(detail.compounding.overall.index).toBeCloseTo(0.4, 12);
  });

  it('prints no detail without --detail', async () => {
    const store = await storePath();
    await cli([
      'campaign',
      'run',
      SPECS,
      '--target',
      'function:acme',
      '--store',
      store,
      '--campaign',
      'c-plain',
    ]);
    const { out } = await cli(['campaign', 'status', 'c-plain', '--store', store]);
    expect(out).not.toContain('Compounding index');
    const detailed = await cli(['campaign', 'status', 'c-plain', '--store', store, '--detail']);
    expect(detailed.out).toContain('  No spec ran in both T and F.');
    expect(detailed.out).toContain('  No perturbed run.');
  });
});

describe('driftbench campaign run', () => {
  it('runs every cell against the Acme agent with every default check, and prints pass per cell', async () => {
    const { code, out } = await cli([
      'campaign',
      'run',
      SPECS,
      '--target',
      'function:acme',
      '--campaign',
      'c-main',
    ]);
    expect(code).toBe(0);
    expect(out).toContain(
      'Campaign c-main: 6 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.',
    );
    expect(out).toContain('✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks');
    expect(out).toContain('6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.');
    expect(out).toContain('The runs are not kept: pass --store <file> to keep them.');
  });

  it('fails a broken agent with the default checks, naming the failing verdicts', async () => {
    const { code, out } = await cli(['campaign', 'run', SPECS, '--target', 'function:acme'], {
      adapterFor: async () => realAcmeAdapter(dropsFirstToolCall),
    });
    expect(code).toBe(1);
    expect(out).toMatch(
      /^✗ acme-plan-upgrade · function:acme · F · repeat 0 {2}fail {2}block 1 tools\.catalog\.search\.count, /m,
    );
    expect(out).toContain('6 cells: 0 pass, 6 fail, 0 failed. Spent $0.00.');
  });

  it('runs with the checks it is given and names the failing verdicts', async () => {
    const { code, out } = await cli(['campaign', 'run', SPECS, '--target', 'function:acme'], {
      checks: minimalChecks,
      adapterFor: async () => acmeAdapter({ wrap: dropsFirstToolCall }),
    });
    expect(code).toBe(1);
    expect(out).toContain('Checks: tools, must, must_not, stage.');
    expect(out).toContain(
      '✗ acme-plan-upgrade · function:acme · F · repeat 0  fail  block 1 tools.catalog.search.count, block 3 tools.order.create.count',
    );
    expect(out).toContain('6 cells: 0 pass, 6 fail, 0 failed. Spent $0.00.');
  });

  it('passes every cell with the minimal checks on the healthy agent', async () => {
    const { code, out } = await cli(
      ['campaign', 'run', SPECS, '--target', 'function:acme', '--repeats', '2'],
      {
        checks: minimalChecks,
      },
    );
    expect(code).toBe(0);
    expect(out).toContain('12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.');
  });

  it('prints one JSON document with --json', async () => {
    const { code, out } = await cli(['campaign', 'run', SPECS, '--target', 'function:acme', '--json'], {
      adapterFor: async () => portingDown(),
    });
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      stored: boolean;
      cells: Array<{ specId: string; state: string; error?: string }>;
      summary: Record<string, number>;
    };
    expect(report.stored).toBe(false);
    expect(report.summary).toEqual({ cells: 6, pass: 5, fail: 0, failed: 1, stoppedByBudget: 0, pending: 0 });
    expect(report.cells.find((cell) => cell.state === 'failed')).toMatchObject({
      specId: 'acme-number-porting',
      error: 'send on block 0 failed: AgentFailure: the porting service is down',
    });
  });

  it('plan exits 2 on a target no adapter is set up for, as run does, and prints no plan', async () => {
    const target = await cli(['campaign', 'plan', SPECS, '--target', 'http:acme']);
    expect(target.code).toBe(2);
    expect(target.err).toContain('No adapter is set up for http:acme.');
    expect(target.out).not.toContain('Plan:');
  });

  it('exits 2 on an unknown target, an invalid spec, or a campaign id already in the store', async () => {
    const target = await cli(['campaign', 'run', SPECS, '--target', 'http:acme']);
    expect(target.code).toBe(2);
    expect(target.err).toContain('No adapter is set up for http:acme.');

    const missing = await cli([
      'campaign',
      'run',
      'examples/acme/specs/nowhere.yaml',
      '--target',
      'function:acme',
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('SPEC_PARSE');
    expect(missing.err).toContain('Fix the invalid specs first: nothing ran.');

    const path = await storePath();
    const run = [
      'campaign',
      'run',
      SPECS,
      '--target',
      'function:acme',
      '--campaign',
      'c-twice',
      '--store',
      path,
    ];
    expect((await cli(run)).code).toBe(0);
    const again = await cli(run);
    expect(again.code).toBe(2);
    expect(again.err).toContain(
      'Campaign c-twice already exists. Resume it with: driftbench campaign resume c-twice',
    );
  });

  it('--cache-suite with a new name does not replay a cell from another suite, and the same name does', async () => {
    const path = await storePath();
    const base = [
      'campaign',
      'run',
      'examples/acme/specs/conversations/plan-upgrade.yaml',
      '--target',
      'function:acme',
      '--store',
      path,
    ];
    await cli([...base, '--campaign', 'c-s1', '--cache-suite', 'nightly-1']);
    const other = await cli([...base, '--campaign', 'c-s2', '--cache-suite', 'nightly-2']);
    expect(other.out).not.toContain('replayed from the cache');
    const same = await cli([...base, '--campaign', 'c-s3', '--cache-suite', 'nightly-1']);
    expect(same.out).toContain('replayed from the cache');
  });

  it('replays a cell from the cache in a later campaign on the same store, unless --no-cache', async () => {
    const path = await storePath();
    const base = [
      'campaign',
      'run',
      'examples/acme/specs/conversations/plan-upgrade.yaml',
      '--target',
      'function:acme',
    ];
    await cli([...base, '--campaign', 'c-first', '--store', path]);
    const replayed = await cli([...base, '--campaign', 'c-second', '--store', path]);
    expect(replayed.out).toContain('pass (replayed from the cache)  5 blocks');
    const fresh = await cli([...base, '--campaign', 'c-third', '--store', path, '--no-cache']);
    expect(fresh.out).toContain('✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks');
  });
});

describe('driftbench campaign run on a pool, with a budget', () => {
  const priced = pricedAcmeAdapter;

  it('stops starting cells once the budget is spent, and names the cells it stopped', async () => {
    const path = await storePath();
    const run = await cli(
      [
        'campaign',
        'run',
        SPECS,
        '--target',
        'function:acme',
        '--campaign',
        'c-budget',
        '--store',
        path,
        '--concurrency',
        '1',
        '--budget-usd',
        '0.05',
      ],
      { adapterFor: async () => priced(), checks: minimalChecks },
    );
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      'Campaign c-budget: 6 cells, 1 at a time. Budget $0.05. Checks: tools, must, must_not, stage.',
    );
    expect(run.out).toContain('✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks');
    expect(run.out).toContain(
      '! acme-off-topic-return · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.09 of its $0.05 budget',
    );
    expect(run.out).toContain('6 cells: 2 pass, 0 fail, 0 failed, 4 stopped by the budget. Spent $0.09.');

    // Resumed without --budget-usd, the budget the campaign was run with still holds.
    const held = await cli(['campaign', 'resume', 'c-budget', '--store', path], {
      adapterFor: async () => priced(),
      checks: minimalChecks,
    });
    expect(held.code).toBe(1);
    expect(held.out).toContain('Budget $0.05.');
    expect(held.out).toContain(
      '6 cells: 2 pass, 0 fail, 0 failed, 4 stopped by the budget, 2 reused. Spent $0.00.',
    );

    const raised = await cli(['campaign', 'resume', 'c-budget', '--store', path, '--budget-usd', '1'], {
      adapterFor: async () => priced(),
      checks: minimalChecks,
    });
    expect(raised.code).toBe(0);
    expect(raised.out).toContain('6 cells: 6 pass, 0 fail, 0 failed, 2 reused. Spent $0.17.');
  });

  it('runs four cells at a time by default and prints them in cell order', async () => {
    const { code, out } = await cli(['campaign', 'run', SPECS, '--target', 'function:acme'], {
      checks: minimalChecks,
    });
    expect(code).toBe(0);
    const order = [...out.matchAll(/^✓ (\S+) /gm)].map((match) => match[1]);
    expect(order).toEqual([
      'acme-new-customer-coverage',
      'acme-number-porting',
      'acme-off-topic-return',
      'acme-order-loose-confirmation',
      'acme-plan-upgrade',
      'acme-tool-failure',
    ]);
  });

  it.each([
    [['--concurrency', '0'], '--concurrency takes a whole number of at least 1, not "0".'],
    [['--concurrency', 'two'], '--concurrency takes a whole number of at least 1, not "two".'],
    [['--budget-usd', '-1'], '--budget-usd takes a number of at least 0, not "-1".'],
  ])('exits 2 on %j', async (options, message) => {
    const { code, err } = await cli(['campaign', 'run', SPECS, '--target', 'function:acme', ...options]);
    expect(code).toBe(2);
    expect(err).toContain(message);
  });

  describe('on the audit runs of a blast-radius campaign', () => {
    const TWISE = 'examples/acme/gated/specs/twise';
    const CHANGE = 'examples/acme/radius/deviation-goal-shift.yaml';
    const audited = (path: string, version: string, id: string, extra: string[]) => [
      'campaign',
      'run',
      TWISE,
      '--target',
      'function:acme',
      '--store',
      path,
      '--no-cache',
      '--concurrency',
      '1',
      '--campaign',
      id,
      '--agent-version',
      version,
      ...extra,
    ];
    const radius = (from: string) => ['--change', CHANGE, '--from', from, '--audit', '4'];

    it(
      'stops the audit when the budget is spent, as it stops the other cells',
      async () => {
        const path = await storePath();
        const deps = { adapterFor: async () => priced(), checks: minimalChecks };
        expect((await cli(audited(path, 'acme-v1', 'c-base', []), deps)).code).toBe(0);
        const free = await cli(audited(path, 'acme-v2', 'c-free', radius('c-base')), deps);
        expect(free.err).toBe('');
        expect(free.out).toContain('run fresh: 0 misses.');

        // At one cent a block, a budget of one cent is spent by the first audited cell.
        const capped = await cli(
          audited(path, 'acme-v2', 'c-capped', [...radius('c-base'), '--budget-usd', '0.01']),
          deps,
        );
        expect(capped.out).toContain('run fresh: 3 misses.');
        expect(capped.out).toContain('gen-twise-046: the audit run did not finish');
      },
      SLOW,
    );

    it(
      'prices the audit from the token table, so the budget also stops token-only usage',
      async () => {
        const path = await storePath();
        const table = join(await tempFolder(), 'prices.yaml');
        await writeFile(
          table,
          'as_of: 2026-10-13\nmodels:\n  fictional-model:\n    input: 2\n    output: 4\n    cached_input: 0.5\n',
        );
        const tokens = () =>
          acmeAdapter({
            wrap: broken((observed) => {
              observed.cost = { inputTokens: 1000, outputTokens: 500, model: 'fictional-model' };
            }),
          });
        const deps = { adapterFor: async () => tokens(), checks: minimalChecks };
        expect((await cli(audited(path, 'acme-v1', 'c-base', []), deps)).code).toBe(0);
        const capped = await cli(
          audited(path, 'acme-v2', 'c-capped', [
            ...radius('c-base'),
            '--prices',
            table,
            '--budget-usd',
            '0.003',
          ]),
          deps,
        );
        expect(capped.err).toBe('');
        expect(capped.out).toContain('run fresh: 3 misses.');
        expect(capped.out).toContain('gen-twise-046: the audit run did not finish');
      },
      SLOW,
    );
  });
});

describe('driftbench campaign status and resume', () => {
  it('shows the failed cell, resumes only it, and reuses the completed cells', async () => {
    const path = await storePath();
    const run = await cli(
      ['campaign', 'run', SPECS, '--target', 'function:acme', '--campaign', 'c-resume', '--store', path],
      { adapterFor: async () => portingDown(), checks: minimalChecks },
    );
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      '! acme-number-porting · function:acme · F · repeat 0  failed  send on block 0 failed: AgentFailure: the porting service is down',
    );

    const status = await cli(['campaign', 'status', 'c-resume', '--store', path]);
    expect(status.code).toBe(1);
    expect(status.out).toContain('6 cells: 5 pass, 0 fail, 1 failed.');

    const healthy = acmeAdapter();
    const resume = await cli(['campaign', 'resume', 'c-resume', '--store', path], {
      adapterFor: async () => healthy,
      checks: minimalChecks,
    });
    expect(resume.code).toBe(0);
    expect(resume.out).toContain('✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks');
    expect(resume.out).toContain(
      '✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (reused)  5 blocks',
    );
    expect(resume.out).toContain('6 cells: 6 pass, 0 fail, 0 failed, 5 reused.');
    expect(healthy.calls.open).toBe(1);

    const after = await cli(['campaign', 'status', 'c-resume', '--store', path, '--json']);
    expect(after.code).toBe(0);
    expect((JSON.parse(after.out) as { summary: { pass: number } }).summary.pass).toBe(6);
  });

  it('exits 2 on a store file it cannot open', async () => {
    const path = await storePath();
    await writeFile(path, 'not a database, only text');
    const { code, err } = await cli(['campaign', 'status', 'c-any', '--store', path]);
    expect(code).toBe(2);
    expect(err).toContain(`Cannot open the store at ${path}: store: `);
  });

  it('takes the latest campaign of the store, by its creation time, when status or resume names none', async () => {
    const path = await storePath();
    await openStore(path).close();
    const empty = await cli(['campaign', 'status', '--store', path]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain(`The store at ${path} holds no campaign.`);

    // Put first, created last: the creation time decides, not the order the store received them.
    await cli(
      ['campaign', 'run', SPECS, '--target', 'function:acme', '--campaign', 'c-first', '--store', path],
      { now: () => new Date('2099-01-01T00:00:00.000Z') },
    );
    await cli(
      [
        'campaign',
        'run',
        'examples/acme/specs/conversations/plan-upgrade.yaml',
        '--target',
        'function:acme',
        '--campaign',
        'c-second',
        '--store',
        path,
      ],
      { now: () => new Date('2026-10-11T00:00:00.000Z') },
    );
    const latest = await cli(['campaign', 'status', '--store', path]);
    expect(latest.code).toBe(0);
    expect(latest.out).toContain('Campaign c-first, created 2099-01-01T00:00:00.000Z.');
    expect(latest.out).toContain('6 cells: 6 pass, 0 fail, 0 failed.');

    const resumed = await cli(['campaign', 'resume', '--store', path]);
    expect(resumed.code).toBe(0);
    expect(resumed.out).toContain('Campaign c-first: 6 cells, 4 at a time.');
    expect(resumed.out).toContain('6 cells: 6 pass, 0 fail, 0 failed, 6 reused.');
  });

  it('notes a spec that names another adapter than --target', async () => {
    const { out } = await cli(['campaign', 'plan', 'examples/acme/specs', '--target', 'function:acme']);
    expect(out).toContain(
      'Note: acme-price-sheet names the process adapter; --target runs it on function:acme.',
    );
    expect(out.match(/^Note: /gm)).toHaveLength(1);
  });

  it('exits 2 for a campaign the store does not hold, and needs --store', async () => {
    const path = await storePath();
    await openStore(path).close();
    const unknown = await cli(['campaign', 'status', 'c-none', '--store', path]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain(`No campaign c-none in ${path}.`);
    const bare = await cli(['campaign', 'resume', 'c-none']);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("required option '--store <file>' not specified");
  });
});

describe('each spec on its own target, without --target', () => {
  it('plans the Acme specs on their own targets: the conversations on the sales assistant, the task on the ops agent', async () => {
    const { code, out } = await cli(['campaign', 'plan', ACME, '--mode', 'F', '--repeats', '2']);
    expect(code).toBe(0);
    expect(out).toContain(
      'Plan: 7 specs, each on its own target (function:acme-sales, process:acme-ops), mode F, 2 repeats: 14 cells, 56 blocks.',
    );
    const cells = out.split('\n').filter((line) => /^ {2}[0-9a-f]{16} /.test(line));
    const task = cells.filter((line) => line.includes('acme-price-sheet'));
    expect(task).toHaveLength(2);
    for (const line of task) expect(line).toMatch(/ process:acme-ops +F +[01] +2$/);
    expect(cells.filter((line) => line.includes(' function:acme-sales '))).toHaveLength(12);
    expect(out).not.toContain('Note: ');
    expect(out).toContain('Projected cost: $0.00 (function: no unit measured; process: no unit measured).');
    expect(out).toContain(
      'Minimum detectable effect, mode F: 45.3 points on a 50% pass rate, with 14 runs per arm over 7 specs',
    );
  });

  it('prices each adapter from its own blocks in a plan on the specs own targets', async () => {
    const path = await storePath();
    const store = openStore(path);
    await store.putUnit({ adapter: 'function', metric: 'block', usd: 0.01, measuredAt: '2026-10-11' });
    await store.close();
    const { code, out } = await cli(['campaign', 'plan', ACME, '--repeats', '2', '--store', path]);
    expect(code).toBe(0);
    // 26 conversation blocks per repeat on the function adapter, 2 task blocks per repeat on the process one.
    expect(out).toContain('Projected cost: $0.52 (function: 52 blocks at $0.01; process: no unit measured).');
  });

  it(
    'runs all 14 cells and passes them through defaultChecks, the price sheet on process:acme-ops, then status takes that campaign',
    async () => {
      const path = await storePath();
      const plan = await cli(['campaign', 'plan', ACME, '--repeats', '2', '--json']);
      const { code, out } = await cli([
        'campaign',
        'run',
        ACME,
        '--mode',
        'F',
        '--repeats',
        '2',
        '--store',
        path,
      ]);
      expect(code, out).toBe(0);
      expect(out).toContain(
        'Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.',
      );
      expect(out).toContain('✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks');
      expect(out).toContain('✓ acme-price-sheet · process:acme-ops · F · repeat 1  pass  2 blocks');
      expect(out).toContain('✓ acme-plan-upgrade · function:acme-sales · F · repeat 1  pass  5 blocks');
      expect(out).toContain('14 cells: 14 pass, 0 fail, 0 failed. Spent $0.00.');

      const store = openStore(path);
      try {
        const [campaign] = await store.listCampaigns();
        // The campaign pins each spec's own target, so status and resume plan the same 14 cells.
        expect(campaign?.targets).toEqual([
          { adapter: 'function', agent: 'acme-sales' },
          { adapter: 'process', agent: 'acme-ops' },
        ]);
        expect(campaign?.specs.find((spec) => spec.id === 'acme-price-sheet')?.target).toEqual({
          adapter: 'process',
          agent: 'acme-ops',
        });
        const planned = (JSON.parse(plan.out) as { cells: Array<{ cellId: string }> }).cells;
        const runs = await store.listRuns({ campaignId: campaign?.campaignId ?? '' });
        expect(new Set(runs.map((run) => run.runId))).toEqual(new Set(planned.map((cell) => cell.cellId)));

        // The price sheet passed on what the checks read, the workbook through the xlsx reader included.
        const sheets = runs.filter((run) => run.specId === 'acme-price-sheet');
        expect(sheets).toHaveLength(2);
        for (const run of sheets) {
          const passed = run.blocks.map((block) =>
            block.verdicts.filter((verdict) => verdict.outcome === 'pass').map((verdict) => verdict.id),
          );
          expect(passed[0]).toEqual(
            expect.arrayContaining([
              'must.0',
              'stage.reached',
              'skills.xlsx',
              'guards.no_destructive_ops.pass',
              'execution.ran_code',
              'execution.exit_code',
              'execution.max_commands',
              'workspace.created',
              'workspace.others_untouched',
              'safety.max_destructive_ops',
              'artifacts.out/acme-price-sheet.xlsx',
              'artifacts.out/acme-price-sheet.xlsx.0.sheets',
              'artifacts.out/acme-price-sheet.xlsx.1.header',
              'artifacts.out/acme-price-sheet.xlsx.4.cells',
              'artifacts.out/acme-price-sheet.xlsx.6.formula',
              'artifacts.out/acme-price-sheet.xlsx.7.no_error_cells',
            ]),
          );
          expect(passed[1]).toEqual(
            expect.arrayContaining([
              'stage.reached',
              'workspace.changed',
              'safety.confirm_before.overwrite',
              'artifacts.out/acme-price-sheet.xlsx.0.sheets',
              'artifacts.out/acme-price-sheet.xlsx.2.cells',
              'artifacts.out/acme-price-sheet.xlsx.3.cells',
            ]),
          );
          expect(run.blocks.map((block) => block.observed.sandbox)).toEqual([
            { kind: 'local', isolation: 'weak' },
            { kind: 'local', isolation: 'weak' },
          ]);
        }
      } finally {
        await store.close();
      }

      const status = await cli(['campaign', 'status', '--store', path]);
      expect(status.code).toBe(0);
      expect(status.out).toContain('✓ acme-price-sheet · process:acme-ops · F · repeat 1  pass  2 blocks');
      expect(status.out).toContain('14 cells: 14 pass, 0 fail, 0 failed.');
    },
    SLOW,
  );

  it(
    'resumes the latest campaign without an id, each cell on the target its spec pinned',
    async () => {
      const path = await storePath();
      const failing = await cli(['campaign', 'run', ACME, '--store', path], {
        adapterFor: async (target, scope) =>
          target.adapter === 'function' ? salesWithPortingDown() : defaultDeps.adapterFor(target, scope),
      });
      expect(failing.code).toBe(1);
      expect(failing.out).toContain(
        '! acme-number-porting · function:acme-sales · F · repeat 0  failed  send on block 0 failed: AgentFailure: the porting service is down',
      );
      expect(failing.out).toContain('7 cells: 6 pass, 0 fail, 1 failed.');

      const asked: string[] = [];
      const resumed = await cli(['campaign', 'resume', '--store', path], {
        adapterFor: async (target, scope) => {
          asked.push(showTarget(target));
          return defaultDeps.adapterFor(target, scope);
        },
      });
      expect(resumed.code, resumed.out).toBe(0);
      expect(resumed.out).toContain(
        '✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks',
      );
      expect(resumed.out).toContain(
        '✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass (reused)  2 blocks',
      );
      expect(resumed.out).toContain('7 cells: 7 pass, 0 fail, 0 failed, 6 reused.');
      expect(asked).toEqual(['function:acme-sales', 'process:acme-ops']);
    },
    SLOW,
  );

  it(
    'runs the price sheet live in a later campaign on the same store, while the conversation replays from the cache',
    async () => {
      const path = await storePath();
      const base = ['campaign', 'run', TASK, 'examples/acme/specs/conversations/plan-upgrade.yaml'];
      expect((await cli([...base, '--campaign', 'c-first', '--store', path])).code).toBe(0);
      const again = await cli([...base, '--campaign', 'c-second', '--store', path]);
      expect(again.code, again.out).toBe(0);
      expect(again.out).toContain(
        '✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass (replayed from the cache)  5 blocks',
      );
      expect(again.out).toContain('✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks');
    },
    SLOW,
  );

  it(
    'keeps the sandboxes in one folder per campaign and removes it when the campaign closes',
    async () => {
      const folders: string[] = [];
      const inside: number[] = [];
      // A check that looks into the campaign folder while a block runs: the run's sandbox is there.
      const peek: Check = {
        name: 'peek',
        applies: () => true,
        async evaluate() {
          inside.push(folders[0] === undefined ? -1 : (await readdir(folders[0])).length);
          return [];
        },
      };
      const { code } = await cli(['campaign', 'run', TASK], {
        adapterFor: async (target, scope) => {
          if (scope) folders.push(await scope.tempDir());
          return defaultDeps.adapterFor(target, scope);
        },
        checks: [...defaultDeps.checks, peek],
      });
      expect(code).toBe(0);
      expect(folders).toHaveLength(1);
      expect(inside).toEqual([1, 1]);
      expect(existsSync(folders[0] ?? '')).toBe(false);
    },
    SLOW,
  );

  it('exits 2 naming a spec that has no target of its own, and runs it with --target', async () => {
    const dir = await tempFolder();
    const spec = join(dir, 'untargeted.yaml');
    await writeFile(
      spec,
      ['id: acme-untargeted', 'blocks:', '  - user: Hello', '    expect: { must: [Acme Telecom] }'].join(
        '\n',
      ),
    );
    for (const command of ['plan', 'run']) {
      const { code, err } = await cli(['campaign', command, spec]);
      expect(code).toBe(2);
      expect(err).toContain(
        'acme-untargeted names no target. Give the spec a target, or run with --target <adapter[:agent]>',
      );
    }
    expect((await cli(['campaign', 'plan', spec, '--target', 'function:acme'])).code).toBe(0);
  });

  it('exits 2 naming the spec whose own target has no adapter', async () => {
    const dir = await tempFolder();
    const spec = join(dir, 'elsewhere.yaml');
    await writeFile(
      spec,
      [
        'id: acme-elsewhere',
        'target: { adapter: http, agent: acme-web }',
        'blocks:',
        '  - user: Hello',
        '    expect: { must: [Acme Telecom] }',
      ].join('\n'),
    );
    const { code, err } = await cli(['campaign', 'run', spec]);
    expect(code).toBe(2);
    expect(err).toContain('No adapter is set up for http:acme-web, the target of acme-elsewhere.');
    expect(err).toContain('process:acme-ops, the Acme ops agent');
  });
});

describe('driftbench campaign retries', () => {
  /** The Acme agent behind a transport that drops the first two sends of the session. */
  const flaky = async () => {
    const adapter = await acmeFunctionAdapter();
    const send = adapter.send.bind(adapter);
    let failures = 2;
    adapter.send = async (session, turn) => {
      if (failures > 0) {
        failures -= 1;
        throw new AdapterTransportError('overloaded', { status: 529 });
      }
      return send(session, turn);
    };
    return adapter;
  };
  const spec = `${SPECS}/plan-upgrade.yaml`;

  it(
    'retries under the command line settings and records each retry in the stored run',
    async () => {
      const store = await storePath();
      const args = ['campaign', 'run', spec, '--target', 'function:acme', '--store', store];
      const ran = await cli([...args, '--campaign', 'c-retry', '--retry-base-ms', '0'], {
        adapterFor: () => flaky(),
      });
      expect(ran.code).toBe(0);
      const opened = await openStore(store);
      const [run] = await opened.listRuns({ campaignId: 'c-retry' });
      await opened.close();
      expect(
        run?.blocks[0]?.observed.retries?.map((event) => [event.call, event.attempt, event.status]),
      ).toEqual([
        ['send on block 0', 1, 529],
        ['send on block 0', 2, 529],
      ]);

      const once = await cli([...args, '--campaign', 'c-retry-once', '--no-cache', '--retry-attempts', '1'], {
        adapterFor: () => flaky(),
      });
      expect(once.code).toBe(1);
      expect(once.out).toMatch(/failed/);
    },
    SLOW,
  );

  it(
    'caps every wait at --retry-max-ms, whatever the base delay',
    async () => {
      const store = await storePath();
      const ran = await cli(
        [
          'campaign',
          'run',
          spec,
          '--target',
          'function:acme',
          '--store',
          store,
          '--campaign',
          'c-retry-cap',
          '--retry-base-ms',
          '60000',
          '--retry-max-ms',
          '0',
        ],
        { adapterFor: () => flaky() },
      );
      expect(ran.code).toBe(0);
      const opened = await openStore(store);
      const [run] = await opened.listRuns({ campaignId: 'c-retry-cap' });
      await opened.close();
      const waits = run?.blocks[0]?.observed.retries?.map((event) => event.delayMs);
      expect(waits).toEqual([0, 0]);

      const bad = await cli([
        'campaign',
        'run',
        spec,
        '--target',
        'function:acme',
        '--store',
        store,
        '--retry-max-ms',
        '-1',
      ]);
      expect(bad.code).toBe(2);
      expect(bad.err).toContain('--retry-max-ms takes a whole number of at least 0, not "-1".');
    },
    SLOW,
  );

  it('refuses a retry setting that is not a whole number', async () => {
    const store = await storePath();
    const { code, err } = await cli([
      'campaign',
      'run',
      spec,
      '--target',
      'function:acme',
      '--store',
      store,
      '--retry-attempts',
      '0',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('--retry-attempts takes a whole number of at least 1, not "0".');
  });
});

describe('campaign --route', () => {
  it('runs the specs a tag marks on the route target, every other spec on --target', async () => {
    const { out, code } = await cli([
      'campaign',
      'plan',
      'examples/acme/specs',
      '--target',
      'function:acme',
      '--route',
      'flow:price-sheet=process:acme-ops',
    ]);
    expect(code).toBe(0);
    // The price-sheet task is routed, so --target no longer overrides it and no note says so.
    expect(out).not.toContain('Note: acme-price-sheet names the process adapter');
    expect(out).toMatch(/acme-price-sheet +process:acme-ops/);
  });

  it('refuses a route that is not tag=target, and a route without --target', async () => {
    const bad = await cli([
      'campaign',
      'plan',
      'examples/acme/specs',
      '--target',
      'function:acme',
      '--route',
      'nothing',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--route takes tag=target');
    const alone = await cli([
      'campaign',
      'plan',
      'examples/acme/specs',
      '--route',
      'flow:price-sheet=process:acme-ops',
    ]);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('--route goes with --target');
  });
});
