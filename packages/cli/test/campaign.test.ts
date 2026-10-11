import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentFailure } from '@driftbench/core';
import { openStore } from '@driftbench/store';
import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { acmeAdapter, dropsFirstToolCall, minimalChecks } from '../../core/test/runner/support';
import { type CampaignDeps, interimDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPECS = 'examples/acme/specs/conversations';

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
    { ...interimDeps, ...deps },
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
  return join(await mkdtemp(join(tmpdir(), 'driftbench-campaign-')), 'store.db');
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
      'Minimum detectable effect, mode F: 46.7 points on a 50% pass rate, with 18 runs per arm (two-sided alpha 0.05, power 0.8).',
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
    expect(out).toContain('Minimum detectable effect, mode F: 28.0 points on a 90% pass rate');
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
    const plan = JSON.parse(out) as { cells: unknown[]; blocks: number; mde: Array<{ effect: number }> };
    expect(plan.cells).toHaveLength(6);
    expect(plan.blocks).toBe(26);
    expect(plan.mde[0]?.effect).toBeCloseTo(0.808748, 5);
  });

  it.each([
    [['--repeats', '2'], 'Name at least one target with --target'],
    [['--target', 'function:acme', '--mode', 'T'], 'Mode T is planned, phase 3.'],
    [['--target', 'function:acme', '--mode', 'X'], 'Unknown mode "X".'],
    [
      ['--target', 'function:acme', '--repeats', '0'],
      '--repeats takes a whole number of at least 1, not "0".',
    ],
    [['--target', 'function:acme', '--baseline-rate', '1'], '--baseline-rate takes a number between 0 and 1'],
    [['--target', 'function:'], '"function:" is not a target. Write <adapter> or <adapter>:<agent>'],
  ])('exits 2 on %j', async (options, message) => {
    const { code, err } = await cli(['campaign', 'plan', SPECS, ...options]);
    expect(code).toBe(2);
    expect(err).toContain(message);
  });
});

describe('driftbench campaign run', () => {
  it('runs every cell against the Acme agent and prints pass per cell', async () => {
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
    expect(out).toContain('Campaign c-main: 6 cells. Checks: none loaded.');
    expect(out).toContain('✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks');
    expect(out).toContain('6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.');
    expect(out).toContain('The runs are not kept: pass --store <file> to keep them.');
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
    expect(report.summary).toEqual({ cells: 6, pass: 5, fail: 0, failed: 1, pending: 0 });
    expect(report.cells.find((cell) => cell.state === 'failed')).toMatchObject({
      specId: 'acme-number-porting',
      error: 'send on block 0 failed: AgentFailure: the porting service is down',
    });
  });

  it('exits 2 on an unknown target, an invalid spec, or a campaign id already in the store', async () => {
    const target = await cli(['campaign', 'run', SPECS, '--target', 'http:acme']);
    expect(target.code).toBe(2);
    expect(target.err).toContain('No adapter in this build reaches http:acme.');

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

  it('exits 2 for a campaign the store does not hold, and needs --store', async () => {
    const path = await storePath();
    const unknown = await cli(['campaign', 'status', 'c-none', '--store', path]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain(`No campaign c-none in ${path}.`);
    const bare = await cli(['campaign', 'resume', 'c-none']);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("required option '--store <file>' not specified");
  });
});
