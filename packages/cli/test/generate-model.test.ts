import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GenerateDeps, registerGenerateCommand } from '../src/commands/generate';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = 'examples/acme/map/approved.yaml';

async function generate(argv: string[], deps: GenerateDeps) {
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
  registerGenerateCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(['generate', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

let dir: string;
let answer: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-model-'));
  // Three proposals written by hand, as a model would answer: one the gate accepts (the tool-failure golden
  // under a new id), one whose Then reads the agent's words only, one that is not a valid spec.
  const toolFailure = (
    await readFile(join(ROOT, 'examples/acme/specs/conversations/tool-failure.yaml'), 'utf8')
  ).replace('id: acme-tool-failure', 'id: model-coverage-down');
  answer = [
    toolFailure,
    'id: model-words-only\nblocks:\n  - user: Hello there\n    expect:\n      must: [Acme]\n',
    'id: model-broken\ntitle: no blocks at all\n',
  ].join('\n---\n');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('driftbench generate --model', { timeout: 300_000 }, () => {
  it('gates every model proposal, counts only the accepted ones, and names the stage that refused each other one', async () => {
    const port = new FakeModelPort([answer], { family: 'mistral', model: 'fake-mistral' });
    const out = join(dir, 'suite');
    const run = await generate(
      [
        '--map',
        MAP,
        '--out',
        out,
        '--model',
        '--proposals',
        '3',
        '--reference',
        'function:acme-sales',
        '--faults',
        'examples/acme/faults',
        '--k',
        '1',
      ],
      { modelPort: () => port },
    );
    expect(run.err).toBe('');
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]?.user).toContain('Propose 3 new specs');
    expect(run.out).toContain('Model proposals: 3 written by mistral fake-mistral, each through the gate.');
    expect(run.out).toMatch(/ {2}model-coverage-down\s+counted\s+3 of 3 blocks accepted\n/);
    expect(run.out).toMatch(
      / {2}model-words-only\s+rejected\s+0 of 1 blocks accepted\s+observed: words-only \(block 0\)/,
    );
    expect(run.out).toMatch(/ {2}model-broken\s+rejected\s+not a spec\s+spec: blocks/);
    expect(run.out).toContain('Counted 1 of 3 proposals.');
    const report = JSON.parse(await readFile(join(out, 'proposed', 'proposals.json'), 'utf8'));
    expect(
      report.proposals.map((entry: { id: string; status: string; stage?: string }) => [
        entry.id,
        entry.status,
        entry.stage,
      ]),
    ).toEqual([
      ['model-coverage-down', 'counted', undefined],
      ['model-words-only', 'rejected', 'observed'],
      ['model-broken', 'rejected', 'spec'],
    ]);
    expect(report.model).toEqual({ family: 'mistral', model: 'fake-mistral' });
  });

  it('needs a reference and a fault set to gate with, and names them', async () => {
    const port = new FakeModelPort([answer], { family: 'mistral' });
    const missing = await generate(['--map', MAP, '--out', join(dir, 'x'), '--model'], {
      modelPort: () => port,
    });
    expect(missing.code).toBe(2);
    expect(missing.err).toContain(
      '--model gates every proposal: give --reference <adapter:agent> and --faults <set>.',
    );
    expect(port.requests).toHaveLength(0);
    const loose = await generate(['--map', MAP, '--out', join(dir, 'y'), '--proposals', '2'], {
      modelPort: () => port,
    });
    expect(loose.code).toBe(2);
    expect(loose.err).toContain('--proposals, --reference, --faults and --k go with --model.');
  });
});
