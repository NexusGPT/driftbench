import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerAttackCommand } from '../src/commands/attack';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ORDER = 'examples/acme/specs/conversations/order-loose-confirmation.yaml';

async function attack(argv: string[], deps: CampaignDeps = defaultDeps) {
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
  registerAttackCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(['attack', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-attack-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench attack', { timeout: 120_000 }, () => {
  it('prints each attack with the reply that cued it and the runner record, writes the recording, and replays it', async () => {
    const recording = join(dir, 'attack.json');
    const first = await attack([ORDER, '--rounds', '4', '--seed', '3', '--record', recording]);
    expect(first.err).toBe('');
    expect(first.out).toContain(
      'Attack: acme-order-loose-confirmation on function:acme-sales, 4 rounds, seed 3.',
    );
    expect(first.out).toMatch(/ {2}round {2}class/);
    expect(first.out).toMatch(/Findings: \d of 4 attacks\./);
    expect(first.out).toContain(`Recording written to ${recording}.`);
    const saved = JSON.parse(await readFile(recording, 'utf8'));
    expect(saved).toMatchObject({ version: 1, spec: 'acme-order-loose-confirmation', seed: 3 });
    expect(saved.rounds).toHaveLength(4);

    const replay = await attack([ORDER, '--replay', recording]);
    expect(replay.code).toBe(first.code);
    const rows = (text: string) => text.split('\n').filter((line) => /^ {2}\d+ {2}/.test(line));
    expect(rows(replay.out)).toEqual(rows(first.out));
  });

  it('exits 1 when an attack finds the agent unsafe or late, and 0 when none does', async () => {
    const clean = await attack([ORDER, '--rounds', '1', '--seed', '0', '--json']);
    const doc = JSON.parse(clean.out);
    expect(clean.code).toBe(doc.findings === 0 ? 0 : 1);
    expect(doc.rounds[0]).toMatchObject({ round: 1, recovery: { injectedAt: expect.any(Number) } });
  });

  it('writes the user-borne attacks through the model port with --model, refusing the agent family', async () => {
    const port = new FakeModelPort(['actually make it cheaper', 'ok whatever', 'hello?'], {
      family: 'mistral',
    });
    const deps = { ...defaultDeps, modelPort: () => port };
    const written = await attack([ORDER, '--rounds', '3', '--model'], deps);
    expect(written.err).toBe('');
    expect(port.requests.length).toBeGreaterThan(0);
    expect(written.out).toContain('model mistral');
    const refused = await attack([ORDER, '--model', '--agent-family', 'mistral'], deps);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('the family of the agent under test: refused');
  });

  it('exits 2 on bad input, naming the fix', async () => {
    const cases: [string[], string][] = [
      [[ORDER, '--rounds', '0'], '--rounds takes a whole number from 1 to 10, not "0".'],
      [[ORDER, '--rounds', '11'], '--rounds takes a whole number from 1 to 10, not "11".'],
      [[ORDER, '--replay', join(dir, 'none.json')], 'cannot be read'],
      [
        [ORDER, '--replay', join(dir, 'attack.json'), '--model'],
        '--replay runs recorded attacks: leave out --model',
      ],
      [[ORDER, '--target', 'function:nobody'], 'No adapter is set up for function:nobody.'],
    ];
    for (const [argv, message] of cases) {
      const result = await attack(argv);
      expect(result.code, argv.join(' ')).toBe(2);
      expect(result.err, argv.join(' ')).toContain(message);
    }
  });
});
