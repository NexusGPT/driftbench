import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile, provenanceHash, runSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { createBlockUser, loadUserCassette } from '@agent-nexus/driftbench-users';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDeps } from '../src/commands/campaign';
import { registerSimulateCommand, type SimulateDeps } from '../src/commands/simulate';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'examples/acme/simulated/plan-upgrade.yaml';
const OPENAI = 'examples/acme/simulated/cassettes/openai-gpt-5.4-nano.json';
const GOOGLE = 'examples/acme/simulated/cassettes/google-gemini-3.5-flash-lite.json';
const PLAIN = 'examples/acme/specs/conversations/plan-upgrade.yaml';

async function simulate(argv: string[], deps: SimulateDeps = defaultDeps) {
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
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });
  registerSimulateCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(['simulate', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

type Report = {
  families: string[];
  trials: number;
  runs: {
    family: string;
    trial: number;
    seed: string;
    status: string;
    blocks: { pass: boolean }[];
    ledger: unknown[];
  }[];
  flips: { block: string; flagged: boolean; families: Record<string, { trials: number; passes: number }> }[];
  calibration: { reference: string; metrics: { metric: string; source: string; dice: number }[] };
  frozen?: string;
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-simulate-blocks-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench simulate on a spec that defines its simulated user in the blocks', {
  timeout: 120_000,
}, () => {
  it('replays the recorded realiser and labeller of two families, with no model call, the same on every run', async () => {
    const first = await simulate([SPEC, '--cassette', OPENAI, '--cassette', GOOGLE, '--json']);
    const second = await simulate([SPEC, '--cassette', OPENAI, '--cassette', GOOGLE, '--json']);
    expect(first.err).toBe('');
    expect(first.out).toBe(second.out);
    const report = JSON.parse(first.out) as Report;
    expect(report.families).toEqual(['openai', 'google']);
    expect(report.trials).toBe(4);
    expect(report.runs).toHaveLength(8);
    expect(report.runs.map((run) => run.seed).slice(0, 4)).toEqual([
      'acme-plan-upgrade-simulated',
      'acme-plan-upgrade-simulated#1',
      'acme-plan-upgrade-simulated#2',
      'acme-plan-upgrade-simulated#3',
    ]);
    for (const run of report.runs) expect(run.status).toBe('completed');
    expect(report.flips).toHaveLength(5);
    expect(report.flips.every((row) => row.families.openai && row.families.google)).toBe(true);
    expect(report.calibration.reference).toBe('abcd-customers');
    expect(report.calibration.metrics.map((row) => row.metric)).toEqual([
      'Short%',
      'Polite%',
      'FrntId%',
      'IDs/turn',
      'Uncert%',
      'Quest%',
    ]);
    // A block that fails in some run makes the exit 1.
    expect(first.code).toBe(1);
  });

  it('prints the trials, pass^k and rerun flip rate per block, the cross-family rate, and the calibration', async () => {
    const { code, out } = await simulate([SPEC, '--cassette', OPENAI, '--cassette', GOOGLE]);
    expect(code).toBe(1);
    expect(out).toContain('4 trials per family (openai, google)');
    expect(out).toContain('Per block: passes, pass^k and rerun flip rate per family.');
    expect(out).toMatch(/openai \d\/\d, pass\^4 /);
    expect(out).toContain('cross-family');
    expect(out).toContain('Calibration against abcd-customers');
    expect(out).toMatch(/Polite% .* \(plan\)/);
    expect(out).toMatch(/Short% .* \(text\)/);
  });

  it('freezes the first failing run as replay blocks that play back the same conversation', async () => {
    const path = join(dir, 'frozen.yaml');
    const { out } = await simulate([SPEC, '--cassette', OPENAI, '--freeze', path, '--json']);
    const report = JSON.parse(out) as Report;
    expect(report.frozen).toBe(path);
    const loaded = await loadSpecFile(path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    for (const block of loaded.spec.blocks) {
      const when = block.when as {
        user: string;
        simulated_user?: { mode: string; recorded?: { hash: string } };
      };
      expect(when.simulated_user?.mode).toBe('replay');
      expect(when.simulated_user?.recorded?.hash).toBe(provenanceHash(when.user));
    }
    // The frozen spec runs with no model and no cassette, and the agent says what it said in the frozen run.
    const failing = report.runs.find((run) => run.blocks.some((block) => !block.pass));
    expect(failing).toBeDefined();
    const adapter = await defaultDeps.adapterFor({ adapter: 'function', agent: 'acme-sales' });
    if (!adapter) throw new Error('no Acme sales adapter');
    const replayed = await runSpec(loaded.spec, {
      adapter,
      driver: createBlockUser({ spec: loaded.spec, agentFamily: 'none', judgeFamilies: [] }),
      checks: defaultChecks(),
      artifacts: defaultReaders(),
      mode: 'F',
      repeat: 0,
    });
    expect(replayed.status).toBe('completed');
    expect(replayed.blocks.map((block) => block.pass)).toEqual(failing?.blocks.map((block) => block.pass));
  });

  it('records a cassette from the model port that replays the same run', async () => {
    const answers = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? 'I want more data on my phone.' : '{"requested_slots": ["email"]}',
    );
    const port = new FakeModelPort(answers, { family: 'mistral', model: 'fake-model' });
    const path = join(dir, 'cassette.json');
    const recorded = await simulate([SPEC, '--model', '--record-cassette', path, '--trials', '1', '--json'], {
      ...defaultDeps,
      modelPort: () => port,
    });
    expect(recorded.err).toBe('');
    const cassette = await loadUserCassette(path);
    expect(cassette.family).toBe('mistral');
    expect(Object.keys(cassette.entries).length).toBeGreaterThan(0);
    const replayed = await simulate([SPEC, '--cassette', path, '--trials', '1', '--json']);
    const a = JSON.parse(recorded.out) as Report;
    const b = JSON.parse(replayed.out) as Report;
    expect(b.runs).toEqual(a.runs);
    expect(JSON.parse(await readFile(path, 'utf8')).model).toBe('fake-model');
  });

  it('refuses bad input with exit 2 before anything runs', async () => {
    const cases: [string[], RegExp][] = [
      [[SPEC], /--model \(the model port\) or --cassette/],
      [[SPEC, '--model', '--cassette', OPENAI], /not both/],
      [[SPEC, '--cassette', OPENAI, '--record-cassette', 'x.json'], /goes with --model/],
      [[SPEC, '--cassette', OPENAI, '--cassette', OPENAI], /same family/],
      [[SPEC, '--cassette', OPENAI, '--trials', '0'], /whole number from 1/],
      [[SPEC, '--cassette', OPENAI, '--labeller', 'regex'], /model or patterns/],
      [[PLAIN, '--cassette', OPENAI], /defines no simulated user in its blocks/],
      [
        [PLAIN, '--persona', 'examples/acme/personas/sam-upgrader.yaml', '--cassette', OPENAI],
        /not with --persona/,
      ],
      [[SPEC, '--cassette', 'examples/acme/simulated/missing.json'], /missing\.json/],
    ];
    for (const [argv, message] of cases) {
      const { code, err } = await simulate(argv);
      expect(code, argv.join(' ')).toBe(2);
      expect(err, argv.join(' ')).toMatch(message);
    }
  });
});
