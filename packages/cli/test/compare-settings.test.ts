import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '@agent-nexus/driftbench-core';
import { type JudgeClient, type JudgeRequest, parseJudgeText } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type ReportDeps, registerCompareCommand } from '../src/commands/compare';
import { rankOutcomes } from '../src/commands/compare-rank';
import type { Io } from '../src/index';

/**
 * The pairwise settings of `driftbench compare` (rows 14 to 16 of the CLI gap list) reach the requests the
 * pairwise judge reads, and `compare --rank` (row 17) orders several campaigns. A stand-in judge records every
 * request; no model is called.
 */

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-compare-settings-'));
  const store = openStore(join(dir, 'store.db'));
  try {
    await storeAcmeCampaign(store, { campaignId: 'v1', modes: ['F'], repeats: 1 });
    await storeAcmeCampaign(store, { campaignId: 'v2', modes: ['F'], repeats: 1 });
    await storeAcmeCampaign(store, { campaignId: 'v3', modes: ['F'], repeats: 1, fault: 'x3-skips-recap' });
  } finally {
    await store.close();
  }
  await writeFile(
    join(dir, 'helpful.yaml'),
    'name: helpful\nrubric: The reply answers the customer question.\n',
  );
  await writeFile(
    join(dir, 'items.yaml'),
    '- { name: answers, rubric: Answers the question., hard: true }\n- { name: brief, rubric: Is brief., weight: 0.5 }\n',
  );
  await writeFile(join(dir, 'reference.txt'), 'The plan costs 30 per month.\n');
}, 180_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * The store with every reply of campaign v2 lengthened by one sentence, so the two campaigns' replies differ
 * and the pair ledger's machine stage does not settle every pair without a call.
 */
function edited(store: Store): Store {
  return new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== 'listRuns') return typeof value === 'function' ? value.bind(target) : value;
      return async (...args: Parameters<Store['listRuns']>) => {
        const runs = await target.listRuns(...args);
        if (args[0]?.campaignId !== 'v2') return runs;
        return runs.map((run) => ({
          ...run,
          blocks: run.blocks.map((block) => ({
            ...block,
            observed: { ...block.observed, text: `${block.observed.text} We are glad to help further.` },
          })),
        }));
      };
    },
  });
}

/** A stand-in judge: records each request and answers in the contract it asks for. */
function standIn(): { client: JudgeClient; requests: JudgeRequest[] } {
  const requests: JudgeRequest[] = [];
  const client: JudgeClient = {
    id: 'stand-in',
    family: 'fake',
    cls: 'system2',
    cost: 1,
    async judge(request) {
      requests.push(request);
      const assessment = request.assessment;
      if (request.answerContract === 'ledger' && assessment?.kind === 'pairwise') {
        const names = assessment.items?.map((item) => item.name) ??
          request.requirements?.map((r) => r.id) ?? [request.criterion.name];
        const items = names.map((name) => ({
          name,
          first: 3,
          second: 1,
          reasoning: 'checked',
          evidence: null,
        }));
        return parseJudgeText(JSON.stringify({ items }), request);
      }
      if (assessment?.kind === 'rubric') {
        const items = assessment.items.map((item) => ({ name: item.name, a: 3, b: 1, reasoning: 'checked' }));
        return parseJudgeText(JSON.stringify({ items }), request);
      }
      return parseJudgeText(
        JSON.stringify({ winner: 'tie', reasoning: 'both meet it', winnerQuote: null }),
        request,
      );
    },
  };
  return { client, requests };
}

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

const base = ['compare', '--baseline', 'v1', '--candidate', 'v2', '--store', 'store.db', '--margin', '2'];

async function pairwise(...flags: string[]) {
  const judge = standIn();
  const deps: ReportDeps = {
    openStore: async (path) => edited(openStore(path)),
    pairwiseClient: () => judge.client,
  };
  const result = await cli([...base, '--pairwise', 'helpful.yaml', ...flags], deps);
  return { ...result, requests: judge.requests };
}

describe('driftbench compare: pairwise settings reach the judge', () => {
  it('keeps the default requests: the winner contract in both orders, no presentation or contract field', async () => {
    const plain = await pairwise();
    expect(plain.err).toBe('');
    expect(plain.out).toMatch(/Pairwise: \d+ pairs, baseline \d+, candidate \d+, tie \d+, inconsistent/);
    expect(plain.requests.length).toBeGreaterThan(0);
    for (const request of plain.requests) {
      expect(request.answerContract).toBeUndefined();
      expect(request.presentation).toBeUndefined();
      expect(request.assessment).toEqual({ kind: 'pairwise' });
    }
    const named = await pairwise('--pairwise-contract', 'winner', '--pairwise-presentation', 'both-orders');
    expect(named.requests).toEqual(plain.requests);
    expect(named.out).toBe(plain.out);
  }, 60_000);

  it('row 16: --pairwise-contract ledger, canonical presentation, items and --no-pairwise-audit', async () => {
    const plain = await pairwise();
    const pairs = plain.requests.length / 2;

    const ledger = await pairwise('--pairwise-contract', 'ledger');
    expect(ledger.err).toBe('');
    expect(ledger.out).toContain('Pairwise (ledger)');
    expect(ledger.requests.length).toBeGreaterThan(0);
    for (const request of ledger.requests) expect(request.answerContract).toBe('ledger');

    const canonical = await pairwise('--pairwise-presentation', 'canonical');
    expect(canonical.err).toBe('');
    expect(canonical.requests).toHaveLength(pairs);
    for (const request of canonical.requests) expect(request.presentation).toBe('canonical');

    const items = await pairwise('--pairwise-items', 'items.yaml');
    expect(items.err).toBe('');
    expect(items.requests[0]?.assessment).toMatchObject({
      kind: 'rubric',
      pairwise: true,
      items: [
        { name: 'answers', rubric: 'Answers the question.', hard: true },
        { name: 'brief', rubric: 'Is brief.', weight: 0.5 },
      ],
    });

    const audited = await pairwise('--pairwise-reference', 'reference.txt');
    expect(audited.requests[0]?.factAudit).toEqual({ reference: 'The plan costs 30 per month.' });
    const unaudited = await pairwise('--pairwise-reference', 'reference.txt', '--no-pairwise-audit');
    expect(unaudited.requests[0]?.factAudit).toBeUndefined();
    expect(unaudited.out).toContain('no audit');
  }, 120_000);

  it('row 14: --pairwise-config reader-first asks two rubric reads per pair, with its thresholds checked', async () => {
    const plain = await pairwise();
    const reader = await pairwise('--pairwise-config', 'reader-first', '--judge-margin', '6');
    expect(reader.err).toBe('');
    expect(reader.out).toContain('Pairwise (reader-first)');
    expect(reader.requests).toHaveLength(plain.requests.length);
    expect(reader.requests[0]?.assessment?.kind).toBe('rubric');
    const bad = await pairwise('--pairwise-config', 'reader-first', '--judge-margin', '0');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--judge-margin takes a positive number, not "0".');
    const orphan = await pairwise('--judge-margin', '4');
    expect(orphan.code).toBe(2);
    expect(orphan.err).toContain('need --pairwise-config reader-first');
  }, 60_000);

  it('row 15: --pairwise-preference long-structured applies after the ledger, and needs the ledger contract', async () => {
    const preferred = await pairwise(
      '--pairwise-contract',
      'ledger',
      '--pairwise-preference',
      'long-structured',
    );
    expect(preferred.err).toBe('');
    expect(preferred.out).toContain('Pairwise (ledger, long-structured)');
    for (const request of preferred.requests) expect(request.answerContract).toBe('ledger');
    // The candidate replies are one sentence longer and neither side is structured: the preference names the
    // longer reply wherever the ledger read is not decided by a hard row.
    const tally = async (...flags: string[]) =>
      (
        JSON.parse((await pairwise(...flags, '--json')).out) as {
          pairwise: { candidate: number; pairs: number };
        }
      ).pairwise;
    const withPreference = await tally(
      '--pairwise-contract',
      'ledger',
      '--pairwise-preference',
      'long-structured',
    );
    const ledgerOnly = await tally('--pairwise-contract', 'ledger');
    expect(withPreference.candidate).toBeGreaterThan(ledgerOnly.candidate);
    const alone = await pairwise('--pairwise-preference', 'long-structured');
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('add --pairwise-contract ledger');
    expect(alone.requests).toHaveLength(0);
    const unknown = await pairwise('--pairwise-contract', 'ledger', '--pairwise-preference', 'shortest');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('--pairwise-preference takes long-structured, not "shortest".');
  }, 60_000);

  it('refuses contradictory pairwise flags before any call', async () => {
    for (const [flags, message] of [
      [['--pairwise-contract', 'votes'], '--pairwise-contract takes winner or ledger, not "votes".'],
      [
        ['--pairwise-presentation', 'one'],
        '--pairwise-presentation takes both-orders or canonical, not "one".',
      ],
      [
        ['--pairwise-contract', 'ledger', '--pairwise-presentation', 'canonical'],
        '--pairwise-contract ledger reads both orders',
      ],
      [['--pairwise-config', 'reader-first', '--pairwise-contract', 'ledger'], 'is its own contract'],
    ] as const) {
      const result = await pairwise(...flags);
      expect(result.code, flags.join(' ')).toBe(2);
      expect(result.err).toContain(message);
      expect(result.requests).toHaveLength(0);
    }
  });
});

describe('driftbench compare --rank', () => {
  it('row 17: ranks three campaigns from the runs they share and prints the order and the cycles', async () => {
    const json = await cli(['compare', '--rank', 'v1', 'v2', 'v3', '--store', 'store.db', '--json']);
    expect(json.err).toBe('');
    const doc = JSON.parse(json.out) as {
      campaigns: string[];
      shared: number[][];
      order?: { campaign: string }[];
      cycles: string[][];
    };
    expect(doc.campaigns).toEqual(['v1', 'v2', 'v3']);
    expect(doc.shared[0]?.[1]).toBeGreaterThan(0);
    expect(json.code).toBe(doc.order === undefined ? 1 : 0);
    expect(doc.cycles).toEqual([]);
    const text = await cli(['compare', '--rank', 'v1', 'v2', 'v3', '--store', 'store.db']);
    expect(text.out).toContain('Shared runs (row against column):');
    expect(text.out).toContain('No three-campaign cycle.');
  }, 60_000);

  it('orders by Bradley-Terry strength, counts a tie half to each, and names a three-campaign cycle', () => {
    const units = (passes: boolean[]) => new Map(passes.map((pass, i) => [`u${i}`, pass]));
    const ranked = rankOutcomes(
      ['a', 'b', 'c'],
      [
        units([true, true, true, false]),
        units([true, true, false, false]),
        units([true, false, false, false]),
      ],
    );
    expect(ranked.order?.map((row) => row.campaign)).toEqual(['a', 'b', 'c']);
    expect(ranked.wins[0]?.[2]).toBe(2);
    expect(ranked.ties[0]?.[2]).toBe(2);
    expect(ranked.cycles).toEqual([]);

    // a beats b on u0, b beats c on u1, c beats a on u2, and all three tie on u3: a cycle, still ranked.
    const cyclic = rankOutcomes(
      ['a', 'b', 'c'],
      [
        new Map([
          ['u0', true],
          ['u2', false],
          ['u3', true],
        ]),
        new Map([
          ['u0', false],
          ['u1', true],
          ['u3', true],
        ]),
        new Map([
          ['u1', false],
          ['u2', true],
          ['u3', true],
        ]),
      ],
    );
    expect(cyclic.cycles).toEqual([['a', 'b', 'c']]);
    expect(cyclic.order).toHaveLength(3);

    const oneWay = rankOutcomes(['a', 'b', 'c'], [units([true]), units([false]), new Map()]);
    expect(oneWay.order).toBeUndefined();
    expect(oneWay.unranked).toContain('not strongly connected');
  });

  it('refuses fewer than three campaigns, a repeated one, and --rank with --baseline', async () => {
    const two = await cli(['compare', '--rank', 'v1', 'v2', '--store', 'store.db']);
    expect(two.code).toBe(2);
    expect(two.err).toContain('--rank takes three or more different campaign ids');
    const repeated = await cli(['compare', '--rank', 'v1', 'v1', 'v2', '--store', 'store.db']);
    expect(repeated.code).toBe(2);
    const mixed = await cli([
      'compare',
      '--rank',
      'v1',
      'v2',
      'v3',
      '--baseline',
      'v1',
      '--store',
      'store.db',
    ]);
    expect(mixed.code).toBe(2);
    expect(mixed.err).toContain('--rank compares campaigns on its own');
    const none = await cli(['compare', '--store', 'store.db']);
    expect(none.code).toBe(2);
    expect(none.err).toContain('compare needs --baseline <campaign> and --candidate <campaign>, or --rank');
  });
});
