import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { registerSimulateCommand, type SimulateDeps } from '../src/commands/simulate';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UPGRADE = 'examples/acme/specs/conversations/plan-upgrade.yaml';
const SAM = 'examples/acme/personas/sam-upgrader.yaml';
const SAM_RECORDING = 'examples/acme/personas/recordings/sam-upgrader.yaml';

type Registered = (program: Command, io: Io, setExit: (code: number) => void) => void;

/** Runs one command the way main does: one program, the command registered, exit 2 on a usage error. */
async function cli(register: Registered, argv: string[]) {
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

/** The simulate command on a fake model port that replays `answers`, with the default campaign deps. */
function withFake(answers: string[], family = 'mistral') {
  const port = new FakeModelPort(answers, { family, model: 'fake-model' });
  const deps: SimulateDeps = { ...defaultDeps, modelPort: () => port };
  return {
    port,
    run: (argv: string[]) =>
      cli(
        (program, io, setExit) => registerSimulateCommand(program, io, setExit, deps),
        ['simulate', ...argv],
      ),
  };
}

const SAM_ANSWERS = [
  "Hi, I'm already an Acme customer and my phone keeps running out of data.",
  'Sure, it is sam.rivera@example.com',
  'The unlimited one, please.',
  'Confirm',
  "No, that's all. Thanks!",
];

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-simulate-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench simulate', { timeout: 60_000 }, () => {
  it('plays the persona on the spec through the model port, block by block, and exits 0 when every block passes', async () => {
    const { run, port } = withFake(SAM_ANSWERS);
    const { code, out, err } = await run([
      UPGRADE,
      '--persona',
      SAM,
      '--target',
      'function:acme-sales',
      '--model',
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain(
      'Simulate: acme-plan-upgrade on function:acme-sales, persona sam-upgrader (Sam Rivera), model mistral fake-model.',
    );
    expect(out).toContain('  1  user   Sure, it is sam.rivera@example.com');
    expect(out).toMatch(/ {2}1 {2}agent {2}Thanks, Sam\. You are on Acme Mobile S/);
    expect(out).toContain('Facts given, each once asked: email.');
    expect(out).toContain('✓ 5 of 5 blocks pass. The run ended: the spec has no block 5.');
    expect(port.requests).toHaveLength(5);
    expect(port.requests[0]?.user).not.toContain('sam.rivera@example.com');
    expect(port.requests[1]?.user).toContain('- email: sam.rivera@example.com');
  });

  it('replays a recording written by hand, with no model and no key', async () => {
    const { run } = withFake([]);
    const { code, out } = await run([UPGRADE, '--persona', SAM, '--recording', SAM_RECORDING]);
    expect(code).toBe(0);
    expect(out).toContain('persona sam-upgrader (Sam Rivera), recording hand-written');
    expect(out).toContain('✓ 5 of 5 blocks pass.');
  });

  it('stops at the stop token, and at --turns, and exits 1 when a block fails', async () => {
    const stopped = await withFake([SAM_ANSWERS[0] as string, '###STOP###']).run([
      UPGRADE,
      '--persona',
      SAM,
      '--model',
    ]);
    expect(stopped.out).toContain('The run ended: the simulated user said the stop token at block 1.');
    expect(stopped.code).toBe(0);

    const capped = await withFake(SAM_ANSWERS).run([UPGRADE, '--persona', SAM, '--model', '--turns', '2']);
    expect(capped.out).toContain('✓ 2 of 2 blocks pass. The run ended: --turns 2 reached.');

    const off = await withFake(['I want to buy a boat.', 'no idea', 'no', 'no', 'no']).run([
      UPGRADE,
      '--persona',
      SAM,
      '--model',
    ]);
    expect(off.code).toBe(1);
    expect(off.out).toMatch(/✗ \d of \d blocks pass\./);
  });

  it("refuses a model of the agent's or a judge's family before anything runs", async () => {
    const same = await withFake(SAM_ANSWERS, 'anthropic').run([
      UPGRADE,
      '--persona',
      SAM,
      '--model',
      '--agent-family',
      'anthropic',
    ]);
    expect(same.code).toBe(2);
    expect(same.out).toBe('');
    expect(same.err).toContain('the family of the agent under test: refused');
    const judge = await withFake(SAM_ANSWERS, 'openai').run([
      UPGRADE,
      '--persona',
      SAM,
      '--model',
      '--judge-family',
      'openai',
    ]);
    expect(judge.code).toBe(2);
    expect(judge.err).toContain('a family of the judges: refused');
  });

  it('exits 2 on bad input, naming the fix', async () => {
    const { run } = withFake(SAM_ANSWERS);
    const bad = join(dir, 'bad-persona.yaml');
    await writeFile(bad, 'id: x\n');
    const cases: [string[], string][] = [
      [
        [UPGRADE, '--persona', SAM],
        'Name where the user speaks from: --model (the model port) or --recording <file>.',
      ],
      [
        [UPGRADE, '--persona', SAM, '--model', '--recording', SAM_RECORDING],
        'Give --model or --recording, not both.',
      ],
      [
        [UPGRADE, '--persona', SAM, '--model', '--turns', '0'],
        '--turns takes a whole number from 1, not "0".',
      ],
      [[UPGRADE, '--persona', bad, '--model'], 'bad-persona.yaml'],
      [
        [UPGRADE, '--persona', SAM, '--model', '--target', 'function:nobody'],
        'No adapter is set up for function:nobody.',
      ],
      [
        [UPGRADE, '--persona', SAM, '--model', '--target', 'http:support'],
        'No adapter is set up for http:support.',
      ],
    ];
    for (const [argv, message] of cases) {
      const result = await run(argv);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.err, argv.join(' ')).toContain(message);
    }
  });
});

describe('driftbench campaign run --driver simulated', { timeout: 60_000 }, () => {
  it('runs each spec a persona plays with that persona, on the recording, and refuses a spec no persona plays', async () => {
    const register: Registered = (program, io, setExit) =>
      registerCampaignCommands(program, io, setExit, defaultDeps);
    const played = await cli(register, [
      'campaign',
      'run',
      UPGRADE,
      '--driver',
      'simulated',
      '--persona',
      SAM,
      '--recording',
      SAM_RECORDING,
      '--repeats',
      '2',
    ]);
    expect(played.err).toBe('');
    expect(played.code).toBe(0);
    expect(played.out).toContain(
      'Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.',
    );
    expect(
      played.out.match(/✓ acme-plan-upgrade · function:acme-sales · F · repeat \d {2}pass {2}5 blocks/g),
    ).toHaveLength(2);

    // A recording whose second answer leaves the script: the cells fail, so the user's words, not the
    // spec's, reached the agent.
    const offScript = join(dir, 'off-script.yaml');
    await writeFile(
      offScript,
      'family: hand-written\nmodel: test\npersona: sam-upgrader\nanswers:\n  - Hi, I am already an Acme customer and run out of data.\n  - I would rather not say.\n  - The unlimited one.\n  - Confirm\n  - Bye\n',
    );
    const off = await cli(register, [
      'campaign',
      'run',
      UPGRADE,
      '--driver',
      'simulated',
      '--persona',
      SAM,
      '--recording',
      offScript,
    ]);
    expect(off.code).toBe(1);
    expect(off.out).toMatch(/✗ acme-plan-upgrade · function:acme-sales · F · repeat 0 {2}fail/);

    const unplayed = await cli(register, [
      'campaign',
      'run',
      'examples/acme/specs/conversations/tool-failure.yaml',
      '--driver',
      'simulated',
      '--persona',
      SAM,
      '--recording',
      SAM_RECORDING,
    ]);
    expect(unplayed.code).toBe(2);
    expect(unplayed.err).toContain('No persona plays acme-tool-failure');

    const scripted = await cli(register, ['campaign', 'run', UPGRADE, '--driver', 'nobody']);
    expect(scripted.code).toBe(2);
    expect(scripted.err).toContain('--driver takes scripted or simulated, not "nobody".');
  });
});
