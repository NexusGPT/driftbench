import type { Campaign, RunResult, Store } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  compareReplays,
  latestReplay,
  type Regression,
  regressionNeeds,
  renderRegression,
  runPassed,
} from '../../src/index';

describe('compareReplays', () => {
  const previous = [
    { spec: 's1', session: 'a', pass: true },
    { spec: 's2', session: 'a', pass: false },
    { spec: 's3', session: 'a', pass: true },
    { spec: 's4', session: 'a', pass: false },
    { spec: 's1', session: 'b', pass: false },
  ];
  const current = [
    { spec: 's1', session: 'a', pass: true },
    { spec: 's2', session: 'a', pass: true },
    { spec: 's3', session: 'a', pass: false },
    { spec: 's4', session: 'a', pass: false },
    { spec: 's5', session: 'a', pass: true },
    { spec: 's1', session: 'b', pass: true },
  ];

  it('flips each spec on each session against its previous run', () => {
    const { runs, counts } = compareReplays(previous, current);
    expect(runs.map((run) => [run.spec, run.session, run.flip])).toEqual([
      ['s1', 'a', 'pass_to_pass'],
      ['s2', 'a', 'fail_to_pass'],
      ['s3', 'a', 'pass_to_fail'],
      ['s4', 'a', 'fail_to_fail'],
      ['s5', 'a', 'no_previous'],
      ['s1', 'b', 'fail_to_pass'],
    ]);
    expect(runs[2]).toEqual({
      spec: 's3',
      session: 'a',
      before: 'pass',
      after: 'fail',
      flip: 'pass_to_fail',
    });
    expect(runs[4]?.before).toBeNull();
    expect(counts).toEqual({
      pass_to_pass: 1,
      fail_to_pass: 2,
      pass_to_fail: 1,
      fail_to_fail: 1,
      no_previous: 1,
    });
  });

  it('has nothing to compare without a previous replay', () => {
    const { counts } = compareReplays(undefined, current);
    expect(counts.no_previous).toBe(6);
  });

  it('asks a person for a pass that turned into a fail only, and prints the flips', () => {
    const regression: Regression = {
      campaign: 'replay-new',
      previous: 'replay-old',
      store: 'runs.db',
      ...compareReplays(previous, current),
      notes: ['one note'],
    };
    expect(regressionNeeds(regression)).toEqual([
      'regression: s3 on the session a passed before and fails now',
    ]);
    const lines = renderRegression(regression);
    expect(lines[0]).toBe('Replay of 6 runs, campaign replay-new, against replay-old.');
    expect(lines).toContain('  broke: s3 on a, pass to fail');
    expect(lines).toContain('  fixed: s2 on a, fail to pass');
    expect(lines).toContain('  note: one note');
    expect(renderRegression({ ...regression, previous: null, store: null })[0]).toContain(
      'no store given: nothing to compare',
    );
  });
});

function run(specId: string, agent: string, pass: boolean, extra: Partial<RunResult> = {}): RunResult {
  return {
    runId: `${specId}-${agent}`,
    specId,
    specHash: 'h',
    target: { adapter: 'claude-code', agent },
    mode: 'F',
    repeat: 0,
    status: 'completed',
    blocks: [{ pass } as RunResult['blocks'][number]],
    succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false },
    cost: 0,
    latencyMs: 0,
    startedAt: 'x',
    finishedAt: 'x',
    cacheHit: false,
    ...extra,
  };
}

describe('latestReplay', () => {
  it('reads the newest replay campaign of the store, and its verdict per spec and session', async () => {
    const campaigns = [
      { campaignId: 'campaign-other' },
      { campaignId: 'replay-b' },
      { campaignId: 'replay-a' },
    ];
    const runs: Record<string, RunResult[]> = {
      'replay-b': [
        run('s1', 'a', true),
        run('s2', 'a', true, { status: 'failed' }),
        run('s3', 'a', true, { endState: { match: false, diff: [] } }),
        run('s4', 'a', false),
      ],
    };
    const store = {
      listCampaigns: async () => campaigns as Campaign[],
      listRuns: async (filter?: { campaignId?: string }) => runs[filter?.campaignId ?? ''] ?? [],
    } as unknown as Store;
    const latest = await latestReplay(store);
    expect(latest).toEqual({
      campaignId: 'replay-b',
      outcomes: [
        { spec: 's1', session: 'a', pass: true },
        { spec: 's2', session: 'a', pass: false },
        { spec: 's3', session: 'a', pass: false },
        { spec: 's4', session: 'a', pass: false },
      ],
    });
    expect(runPassed(run('s1', 'a', true))).toBe(true);
    const empty = { listCampaigns: async () => [{ campaignId: 'campaign-x' }] } as unknown as Store;
    expect(await latestReplay(empty)).toBeUndefined();
  });
});
