import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeJudge } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { defaultPairwiseClient, type ReportDeps, registerCompareCommand } from '../src/commands/compare';
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

  it('asks for the judge --pairwise-judge names, openai by default, and refuses an unknown name', async () => {
    const asked: string[] = [];
    const deps: ReportDeps = {
      openStore: async (path) => openStore(path),
      pairwiseClient: (kind) => {
        asked.push(kind);
        return new FakeJudge('pairwise', [{ outcome: 'pass', reasoning: 'A reads better' }]);
      },
    };
    await cli([...base, '--pairwise', join(dir, 'helpful.yaml')], deps);
    await cli([...base, '--pairwise', join(dir, 'helpful.yaml'), '--pairwise-judge', 'google'], deps);
    expect(asked).toEqual(['openai', 'google']);

    expect(() => defaultPairwiseClient('bogus')).toThrow(
      'unknown pairwise judge bogus: use openai, anthropic or google',
    );
    const refused = await cli(
      [...base, '--pairwise', join(dir, 'helpful.yaml'), '--pairwise-judge', 'bogus'],
      {
        openStore: async (path) => openStore(path),
        pairwiseClient: defaultPairwiseClient,
      },
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('unknown pairwise judge bogus');
  });

  it('refuses a pairwise judge of the agent family on every judge path, before any call', async () => {
    let calls = 0;
    const deps: ReportDeps = {
      openStore: async (path) => openStore(path),
      pairwiseClient: () => {
        const judge = new FakeJudge('pairwise', [{ outcome: 'pass', reasoning: 'A reads better' }], {
          family: 'openai',
        });
        const ask = judge.judge.bind(judge);
        judge.judge = async (request) => {
          calls += 1;
          return ask(request);
        };
        return judge;
      },
    };
    const pairwise = [...base, '--pairwise', join(dir, 'helpful.yaml'), '--agent-family', 'openai'];
    const byDefault = await cli(pairwise, deps);
    expect(byDefault.code).toBe(2);
    expect(byDefault.err).toContain('judge pairwise is from the openai family');
    const named = await cli([...pairwise, '--pairwise-judge', 'openai'], deps);
    expect(named.code).toBe(2);
    expect(calls).toBe(0);
    const other = await cli(
      [...base, '--pairwise', join(dir, 'helpful.yaml'), '--agent-family', 'google'],
      deps,
    );
    expect(other.err).toBe('');
    expect(calls).toBeGreaterThan(0);
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
    expect(
      judge.requests.every((request) =>
        request.transcript.some(
          (entry) => entry.text === 'Reference answer: Acme Air 5G at 88 Summit Avenue, $35 a month.',
        ),
      ),
    ).toBe(true);
    expect([0, 1]).toContain(code);
  });

  it('a missing reference file is bad input: exit 2, the path named', async () => {
    const { code, err } = await cli([
      ...base,
      '--pairwise',
      join(dir, 'helpful.yaml'),
      '--pairwise-reference',
      join(dir, 'no-reference.txt'),
    ]);
    expect(code).toBe(2);
    expect(err).toMatch(/no-reference\.txt/);
  });
});
