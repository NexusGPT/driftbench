import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeJudge } from '@driftbench/judges';
import { openStore } from '@driftbench/store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type ReportDeps, registerCompareCommand } from '../src/commands/compare';
import type { Io } from '../src/index';

let dir = '';
let db = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-pairwise-'));
  db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F'], repeats: 1 });
    await storeAcmeCampaign(store, { campaignId: 'c-acme-again', modes: ['F'], repeats: 1 });
  } finally {
    await store.close();
  }
  await writeFile(
    join(dir, 'helpful.yaml'),
    'name: helpful\nrubric: The reply answers the customer question.\n',
  );
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[], deps?: ReportDeps) {
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
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerCompareCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps ?? { openStore: async (path) => openStore(path) },
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

const base = [
  'compare',
  '--baseline',
  'c-acme',
  '--candidate',
  'c-acme-again',
  '--store',
  'store.db',
  '--margin',
  '2',
];

describe('driftbench compare --pairwise', () => {
  it('judges each reply pair in both orders and prints the tally', async () => {
    const deps: ReportDeps = {
      openStore: async (path) => openStore(path),
      pairwiseClient: () => new FakeJudge('pairwise', [{ outcome: 'pass', reasoning: 'A reads better' }]),
    };
    const { out, err } = await cli([...base, '--pairwise', join(dir, 'helpful.yaml')], deps);
    expect(err).toBe('');
    const line = out.match(
      /Pairwise: (\d+) pairs, baseline (\d+), candidate (\d+), tie (\d+), inconsistent (\d+), position bias (\d+)\./,
    );
    expect(line, out).not.toBeNull();
    const [, pairs, baseline, candidate, tie, inconsistent, bias] = line ?? [];
    expect(Number(pairs)).toBeGreaterThan(0);
    expect(Number(baseline)).toBe(0);
    expect(Number(candidate)).toBe(0);
    expect(Number(tie)).toBe(Number(pairs));
    expect(Number(inconsistent)).toBe(Number(pairs));
    expect(Number(bias)).toBe(Number(pairs));
  });

  it('a missing criterion file is bad input: exit 2, the path named', async () => {
    const { code, err } = await cli([...base, '--pairwise', join(dir, 'missing.yaml')]);
    expect(code).toBe(2);
    expect(err).toMatch(/missing\.yaml/);
  });

  it('a judge that gives no answer fails the command, never a tie', async () => {
    const deps: ReportDeps = {
      openStore: async (path) => openStore(path),
      pairwiseClient: () => new FakeJudge('pairwise', [new Error('provider unreachable')]),
    };
    const { code, err, out } = await cli([...base, '--pairwise', join(dir, 'helpful.yaml')], deps);
    expect(code).toBe(2);
    expect(err).toMatch(/provider unreachable/);
    expect(out).not.toMatch(/Pairwise:/);
  });

  it('with --pairwise-reference, every call names the reference answer, and the tally line is unchanged', async () => {
    await writeFile(join(dir, 'reference.txt'), 'Acme Air 5G at 88 Summit Avenue, $35 a month.\n');
    const judge = new FakeJudge('pairwise', [{ outcome: 'pass', reasoning: 'A reads better' }]);
    const deps: ReportDeps = { openStore: async (path) => openStore(path), pairwiseClient: () => judge };
    const { code, out, err } = await cli(
      [...base, '--pairwise', join(dir, 'helpful.yaml'), '--pairwise-reference', join(dir, 'reference.txt')],
      deps,
    );
    expect(err).toBe('');
    expect(out).toMatch(/Pairwise: \d+ pairs/);
    expect(judge.requests.length).toBeGreaterThan(0);
    expect(judge.requests.every((request) => request.transcript.some((entry) => entry.text === 'Reference answer: Acme Air 5G at 88 Summit Avenue, $35 a month.'))).toBe(true);
    expect([0, 1]).toContain(code);
  });

  it('a missing reference file is bad input: exit 2, the path named', async () => {
    const { code, err } = await cli([...base, '--pairwise', join(dir, 'helpful.yaml'), '--pairwise-reference', join(dir, 'no-reference.txt')]);
    expect(code).toBe(2);
    expect(err).toMatch(/no-reference\.txt/);
  });
});
