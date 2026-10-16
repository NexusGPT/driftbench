import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlockResult, RunResult } from '@agent-nexus/driftbench-core';
import { compareReplays } from '@agent-nexus/driftbench-estate';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { acmeAdapter } from '../../core/test/runner/support';
import { defaultDeps } from '../src/commands/campaign';
import { rankInputs } from '../src/commands/compare-rank';
import { lineOf } from '../src/commands/estate-live';
import { familyVerifyCommand } from '../src/commands/family';
import { gateExit } from '../src/commands/gate-exit';
import { registerPerturbCommand } from '../src/commands/perturb';
import { registerRedteamCommand } from '../src/commands/redteam';
import { registerSimulateCommand } from '../src/commands/simulate';
import { type Io, main } from '../src/index';
import { passingAndFailing } from '../src/view/server';

/**
 * The commands that print a pass or a fail per spec or per block: a block not run or blocked is neither. It is
 * counted apart and named with its reason, never printed as a failure and never as a pass.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOOL_FAILURE = 'examples/acme/specs/conversations/tool-failure.yaml';
const SAM = 'examples/acme/personas/sam-upgrader.yaml';
const SLOW = 120_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-not-run-consumers-'));
  made.push(dir);
  return dir;
}

type Registered = (program: Command, io: Io, setExit: (code: number) => void) => void;

async function cli(argv: string[], register?: Registered) {
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
  if (!register) return { code: await main(argv, io), out, err };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  register(program, io, (exit) => {
    code = exit;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

/** The Acme agent on an adapter that cannot force a tool result: a spec that forces one is not run. */
const noStubs = {
  ...defaultDeps,
  adapterFor: async () => acmeAdapter({ capabilities: { toolStubs: false } }),
};

const NOT_RUN = {
  kind: 'unsupported' as const,
  layer: '5 world',
  check: 'capability',
  expected: 'e',
  got: 'g',
};

function syntheticRun(
  repeat: number,
  last: 'pass' | 'fail' | 'not_run' | 'blocked',
  specId = 'g',
): RunResult {
  const block = (index: number, kind: 'pass' | 'fail' | 'not_run' | 'blocked'): BlockResult => ({
    index,
    givenHash: `g${index}`,
    observed: { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 },
    verdicts:
      kind === 'fail'
        ? [{ id: 'must.0', kind: 'machine', name: 'must', gating: true, outcome: 'fail', evidence: 'x' }]
        : [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: kind === 'fail' ? ['X1_local'] : [],
    pass: kind === 'pass',
    ...(kind === 'not_run' ? { status: 'not_run' as const, notRun: NOT_RUN } : {}),
    ...(kind === 'blocked'
      ? { status: 'blocked' as const, blocked: { by: 'block 0', root: 'block 0' } }
      : {}),
  });
  return {
    runId: `${specId}-r${repeat}`,
    specId,
    specHash: 'h',
    target: { adapter: 'function', agent: 'acme-sales' },
    mode: 'F',
    repeat,
    status: 'completed',
    blocks: [block(0, 'pass'), block(1, last)],
    succession: { driftCount: 0, driftRate: 0, longestClean: 1, minOverBlocks: last === 'pass' },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
  };
}

describe('replay: a spec whose block is not run is counted apart', () => {
  it(
    'prints 1 pass, 0 fail, 1 not run; the JSON gives the run its outcome and the reason',
    async () => {
      const dir = await temp();
      const specs = join(dir, 'specs');
      const sessions = join(dir, 'sessions');
      await mkdir(specs);
      await mkdir(sessions);
      for (const name of ['pass', 'skip']) {
        await writeFile(
          join(sessions, `${name}.jsonl`),
          [
            { type: 'user', message: { role: 'user', content: 'Report the result.' } },
            {
              type: 'assistant',
              message: { role: 'assistant', content: [{ type: 'text', text: 'balanced' }] },
            },
          ]
            .map((line) => JSON.stringify(line))
            .join('\n'),
        );
        await writeFile(
          join(specs, `${name}.yaml`),
          [
            `id: ${name}`,
            'kind: task',
            'metadata:',
            `  replay: { session: ${name} }`,
            ...(name === 'skip' ? ['given: { world: { tools: { lookup: { result: { ok: true } } } } }'] : []),
            'blocks:',
            '  - user: Report the result.',
            '    expect:',
            "      must: ['^balanced$']",
            '',
          ].join('\n'),
        );
      }
      const args = ['replay', join(sessions, 'pass.jsonl'), join(sessions, 'skip.jsonl'), '--suite', specs];
      const json = await cli([...args, '--json']);
      expect(json.err).toBe('');
      const report = JSON.parse(json.out) as {
        runs: Array<{ spec: string; pass: boolean; outcome?: string; failing: string[] }>;
        passed: number;
        failed: number;
        notRun?: number;
      };
      expect({ passed: report.passed, failed: report.failed, notRun: report.notRun }).toEqual({
        passed: 1,
        failed: 0,
        notRun: 1,
      });
      const skip = report.runs.find((run) => run.spec === 'skip');
      expect(skip?.outcome).toBe('not_run');
      expect(skip?.failing[0]).toMatch(/^block 0: not run \(capability: /);
      const text = await cli(args);
      expect(text.out).toContain('2 specs replayed: 1 pass, 0 fail, 1 not run or blocked.');
      expect(text.out).toMatch(/^- skip /m);
    },
    SLOW,
  );
});

describe('estate regression: a spec not run on either side is never a flip', () => {
  it('a pass before and a not run now is not_measured, never pass_to_fail', () => {
    const result = compareReplays(
      [
        { spec: 'a', session: 's', pass: true },
        { spec: 'b', session: 's', pass: true },
      ],
      [
        { spec: 'a', session: 's', pass: false, outcome: 'not_run' },
        { spec: 'b', session: 's', pass: false },
      ],
    );
    expect(result.counts.pass_to_fail).toBe(1);
    expect(result.counts.not_measured).toBe(1);
    expect(result.runs.find((run) => run.spec === 'a')).toMatchObject({
      flip: 'not_measured',
      after: 'not_run',
    });
  });
});

describe('estate live: the line of a run with a block not run', () => {
  it('carries its outcome and names the block in failing', () => {
    const line = lineOf(syntheticRun(0, 'not_run'), 0);
    expect(line.pass).toBe(false);
    expect(line.outcome).toBe('not_run');
    expect(line.failing).toEqual(['block 1: not run (capability: g)']);
    expect(lineOf(syntheticRun(0, 'fail'), 0).outcome).toBeUndefined();
  });
});

describe('viewer and rank: runs not run or blocked are their own count', () => {
  const runs = [
    syntheticRun(0, 'pass'),
    syntheticRun(1, 'not_run'),
    syntheticRun(2, 'blocked'),
    syntheticRun(3, 'fail'),
  ];

  it('the viewer index counts 1 passing, 1 failing, 2 not run or blocked', () => {
    expect(passingAndFailing(runs)).toEqual({ passing: 1, failing: 1, unscored: 2 });
  });

  it('compare --rank leaves out and counts the runs with no outcome', () => {
    const campaigns = ['a', 'b'].map((id) => ({
      campaign: { campaignId: id },
      runs: runs.map((run, i) => ({ ...run, specId: `s${i}`, runId: `${id}-${i}` })),
    })) as unknown as Parameters<typeof rankInputs>[0];
    const inputs = rankInputs(campaigns, ['a', 'b'], undefined);
    if ('error' in inputs) throw new Error(inputs.error);
    expect(inputs.unscored).toEqual([2, 2]);
    expect([...(inputs.outcomes[0]?.values() ?? [])]).toEqual([true, false]);
  });
});

describe('monitor: a campaign point says how many runs it left out', () => {
  it('pass_rate is 1 over the scored run, with 2 runs not run or blocked, in the JSON and the series', async () => {
    const path = join(await temp(), 'monitor.db');
    const store = openStore(path);
    try {
      for (let day = 0; day < 4; day += 1) {
        const campaignId = `c-${day}`;
        await store.putCampaign({
          campaignId,
          specs: [{ id: 'g', hash: 'h' }],
          targets: [{ adapter: 'function', agent: 'acme-sales' }],
          modes: ['F'],
          repeats: { T: 0, F: 3, P: 0 },
          budgetUsd: 0,
          judge: { mode: 'system1', judges: [] },
          createdAt: new Date(Date.UTC(2026, 0, 1 + day, 9)).toISOString(),
        });
        for (const [repeat, last] of (['pass', 'not_run', 'blocked'] as const).entries())
          await store.putRun(campaignId, { ...syntheticRun(repeat, last), runId: `${campaignId}-${repeat}` });
      }
    } finally {
      await store.close();
    }
    const args = ['monitor', '--store', path, '--metric', 'pass_rate', '--window', '2'];
    const json = await cli([...args, '--json']);
    expect(json.err).toBe('');
    const report = JSON.parse(json.out) as {
      series: Array<{ value: number; runs: number; unscored?: number }>;
    };
    expect(report.series[0]).toMatchObject({ value: 1, runs: 3, unscored: 2 });
    const text = await cli([...args, '--series']);
    expect(text.out).toContain('3 (2 not run or blocked)');
  });
});

describe('simulate and perturb on a target that cannot run the spec', () => {
  it(
    'simulate marks each block not run, never a fail, and counts the pass rate over the scored blocks',
    async () => {
      const port = new FakeModelPort(Array(10).fill('Hello.'), { family: 'mistral', model: 'fake-model' });
      const deps = { ...noStubs, modelPort: () => port };
      const result = await cli(
        ['simulate', TOOL_FAILURE, '--persona', SAM, '--target', 'function:acme-sales', '--model'],
        (program, io, setExit) => registerSimulateCommand(program, io, setExit, deps),
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(result.out).toContain('- not run');
      expect(result.out).not.toMatch(/ {2}✗\n/);
      expect(result.out).toMatch(/✗ 0 of 0 blocks pass, \d+ not run or blocked\./);
    },
    SLOW,
  );

  it(
    'perturb says the deviation never reached the agent, and prints no block as a failure',
    async () => {
      const result = await cli(
        ['perturb', TOOL_FAILURE, '--class', 'D8', '--at', '1', '--target', 'function:acme-sales'],
        (program, io, setExit) => registerPerturbCommand(program, io, setExit, noStubs),
      );
      expect(result.out).toContain(
        'Recovery not measured: the deviation sales-queue-down never reached the agent: block 0 was not run.',
      );
      expect(result.out).toMatch(/0 of 0 blocks pass \(\d+ not run or blocked\)/);
      expect(result.out).not.toContain('✗');
      expect(result.out).toContain('not run: capability');
    },
    SLOW,
  );
});

describe('redteam grade on a target that cannot run the spec', () => {
  it(
    'prints the run as not run, never as not passed, with the outcome in the JSON',
    async () => {
      const run = (json: boolean) =>
        cli(
          [
            'redteam',
            'grade',
            TOOL_FAILURE,
            '--target',
            'function:acme-sales',
            '--judge',
            'openai',
            ...(json ? ['--json'] : []),
          ],
          (program, io, setExit) =>
            registerRedteamCommand(program, io, setExit, noStubs, () => ({
              id: 'unused',
              family: 'openai',
              cls: 'system2',
              cost: 1,
              judge: async () => {
                throw new Error('no judge call: no block was sent');
              },
            })),
        );
      const json = await run(true);
      expect(json.err).toBe('');
      expect(JSON.parse(json.out)).toMatchObject({ passed: false, outcome: 'not_run' });
      const text = await run(false);
      expect(text.out).toContain('not run (a block was not sent)');
      expect(text.out).not.toContain('not passed');
    },
    SLOW,
  );
});

describe('family verify on a reference that cannot run the spec', () => {
  it(
    'counts the instance apart as unverified, never as a reference defect, and exits 3',
    async () => {
      const dir = await temp();
      await writeFile(join(dir, 'tool-failure.yaml'), await readFile(join(ROOT, TOOL_FAILURE), 'utf8'));
      let out = '';
      let err = '';
      const io: Io = {
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
        cwd: dir,
      };
      const code = await familyVerifyCommand(
        '.',
        { reference: 'function:acme-sales', concurrency: '1' },
        io,
        noStubs,
      );
      expect(err).toBe('');
      expect(code).toBe(3);
      expect(out).toContain('- tool-failure.yaml  not run');
      expect(out).toContain('could not run 1 instances');
      expect(out).not.toContain('reference defect');
    },
    SLOW,
  );
});

describe('the exit of a command that gates a pipeline', () => {
  it('is 0 when all pass, 1 when one fails, failed or stopped, and 3 when none did but one was not run', () => {
    expect(gateExit(['pass', 'pass'])).toBe(0);
    expect(gateExit(['pass', 'not_run'])).toBe(3);
    expect(gateExit(['blocked'])).toBe(3);
    expect(gateExit(['not_run', 'fail'])).toBe(1);
    expect(gateExit(['not_run', 'failed'])).toBe(1);
    expect(gateExit(['pass', 'stopped'])).toBe(1);
  });
});
