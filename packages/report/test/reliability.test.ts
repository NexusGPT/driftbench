import { passAtK, passK, unreliability, wilson } from '@agent-nexus/driftbench-stats';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { describe, expect, it } from 'vitest';
import { blockScore, loadCampaign, ReportInputError, runPassed } from '../src/data';
import { modeReliability, recoveryOf, reliability, successionOf } from '../src/reliability';
import { dataOf, FIXED, run, storeAcmeCampaign } from './support';

describe('runPassed', () => {
  it('needs a completed run, a block, every block passing and a matching end state', () => {
    expect(runPassed(run())).toBe(true);
    expect(runPassed(run({ status: 'failed' }))).toBe(false);
    expect(runPassed(run({ blocks: [] }))).toBe(false);
    expect(runPassed(run({ blocks: [{}, { pass: false }] }))).toBe(false);
    expect(runPassed(run({ endState: { match: false, diff: [] } }))).toBe(false);
    expect(runPassed(run({ endState: { match: true, diff: [] } }))).toBe(true);
  });

  it('scores a run by its share of passing blocks', () => {
    expect(blockScore(run({ blocks: [{}, { pass: false }, {}, {}] }))).toBe(0.75);
    expect(blockScore(run({ blocks: [] }))).toBe(0);
  });
});

describe('reliability per line', () => {
  // Three repeats of one golden: two pass, one fails at block 1.
  const runs = [
    run({ repeat: 0, blocks: [{}, {}, {}] }),
    run({ repeat: 1, blocks: [{}, { pass: false, drift: ['X3_flow'] }, {}] }),
    run({ repeat: 2, blocks: [{}, {}, {}] }),
  ];
  const [line] = reliability(dataOf(runs));

  it('makes one line per golden, target, mode and perturbation', () => {
    const more = reliability(
      dataOf([
        ...runs,
        run({ mode: 'T' }),
        run({ mode: 'P', perturbationId: 'p1' }),
        run({ mode: 'P', perturbationId: 'p2' }),
        run({ target: { adapter: 'function', agent: 'other' } }),
      ]),
    );
    expect(
      more.map((entry) => `${entry.mode} ${entry.perturbationId ?? ''} ${entry.target.agent} ${entry.runs}`),
    ).toEqual(['F  demo 3', 'T  demo 1', 'P p1 demo 1', 'P p2 demo 1', 'F  other 1']);
  });

  it('gives the pass rate with its Wilson interval', () => {
    const w = wilson(2, 3);
    expect(line?.passRate).toMatchObject({
      k: 2,
      n: 3,
      estimate: 2 / 3,
      lower: w.lower,
      upper: w.upper,
      method: 'wilson',
    });
  });

  it('gives pass^k and pass@k for every k, the Wilson bounds raised the same way', () => {
    const w = wilson(2, 3);
    expect(line?.passK.map((entry) => entry.value)).toEqual([passK(2, 3, 1), passK(2, 3, 2), passK(2, 3, 3)]);
    expect(line?.passAtK.map((entry) => entry.value)).toEqual([
      passAtK(2, 3, 1),
      passAtK(2, 3, 2),
      passAtK(2, 3, 3),
    ]);
    expect(line?.passK[1]).toMatchObject({ k: 2, lower: w.lower ** 2, upper: w.upper ** 2 });
    expect(line?.passAtK[2]?.lower).toBeCloseTo(1 - (1 - w.lower) ** 3, 12);
    // The raised upper bound is just below 1, but the value is 1: the interval is widened to contain the value.
    expect(line?.passAtK[2]?.upper).toBeCloseTo(Math.max(1 - (1 - w.upper) ** 3, 1), 12);
  });

  it('measures unreliability as p90 minus p10 of the block score across repeats', () => {
    expect(line?.unreliability.estimate).toBeCloseTo(unreliability([1, 2 / 3, 1]), 12);
    expect(line?.unreliability.method).toBe('cluster bootstrap');
    expect(line?.unreliability.clusters).toBe(3);
  });

  it('pools blocks with the run, one conversation, as the cluster', () => {
    expect(line?.blockAccuracy).toMatchObject({
      estimate: 8 / 9,
      n: 9,
      clusters: 3,
      method: 'wilson, design effect',
    });
  });

  it('gives no interval over a single run, and says so', () => {
    const [single] = reliability(dataOf([run({ blocks: [{}, { pass: false }] })]));
    expect(single?.blockAccuracy?.method).toBe('none');
    expect(single?.blockAccuracy?.lower).toBe(single?.blockAccuracy?.estimate);
  });
});

describe('succession summary', () => {
  it('counts where drift starts, how much, and the classes', () => {
    const summary = successionOf([
      run({ repeat: 0, blocks: [{}, { pass: false, drift: ['X3_flow', 'X5_tool'] }, { pass: false }] }),
      run({ repeat: 1, blocks: [{ pass: false, drift: ['X4_format'] }, {}, {}] }),
      run({ repeat: 2, blocks: [{}, {}, {}] }),
      run({ repeat: 3, blocks: [{}, { pass: false, drift: ['X3_flow'] }, {}] }),
    ]);
    expect(summary.firstDrift).toEqual([
      { block: 0, runs: 1 },
      { block: 1, runs: 2 },
      { block: 'none', runs: 1 },
    ]);
    expect(summary.classes).toEqual({ X1_local: 1, X3_flow: 2, X4_format: 1, X5_tool: 1 });
    expect(summary.driftCount?.estimate).toBe(1);
    expect(summary.driftRate).toMatchObject({ estimate: 4 / 12, clusters: 4 });
    expect(summary.allBlocksPass).toMatchObject({ k: 1, n: 4 });
    expect(summary.longestClean).toBe((1 + 2 + 3 + 1) / 4);
  });
});

describe('recovery summary', () => {
  it('reads labels, turns over the runs that came back, and rates over the runs that say', () => {
    const summary = recoveryOf([
      run({
        recovery: {
          injectedAt: 1,
          turnsToRecover: 0,
          label: 'immediate',
          collateral: 0,
          safeAction: true,
          clarified: true,
        },
      }),
      run({
        recovery: { injectedAt: 1, turnsToRecover: 3, label: 'late', collateral: 2, safeAction: false },
      }),
      run({ recovery: { injectedAt: 1, label: 'never', collateral: 1, safeAction: true, clarified: false } }),
      run({ recovery: { injectedAt: 1, turnsToRecover: 1, label: 'immediate', collateral: 0 } }),
      // A run that never came back does not count toward the turns, even if it carries a number.
      run({ recovery: { injectedAt: 1, turnsToRecover: 9, label: 'never', collateral: 0 } }),
      run(),
    ]);
    expect(summary?.measured).toBe(5);
    expect(summary?.labels).toEqual({ immediate: 2, late: 1, never: 2 });
    expect(summary?.immediate).toMatchObject({ k: 2, n: 5 });
    expect(summary?.recovered).toMatchObject({ k: 3, n: 5 });
    expect(summary?.medianTurns).toBe(1);
    expect(summary?.collateral?.estimate).toBe(3 / 5);
    expect(summary?.safeAction).toMatchObject({ k: 2, n: 3 });
    expect(summary?.clarified).toMatchObject({ k: 1, n: 2 });
  });

  it('is absent when no run measured recovery', () => {
    expect(recoveryOf([run(), run()])).toBeUndefined();
  });
});

describe('per mode', () => {
  it('takes the repeats of one golden as one cluster for the run pass rate', () => {
    const runs = [
      ...[0, 1, 2].map((repeat) => run({ specId: 'a', repeat })),
      ...[0, 1, 2].map((repeat) => run({ specId: 'b', repeat, blocks: [{ pass: false }] })),
    ];
    const data = dataOf(runs);
    const [mode] = modeReliability(data, reliability(data));
    expect(mode).toMatchObject({ mode: 'F', lines: 2, runs: 6 });
    expect(mode?.runPass).toMatchObject({ estimate: 0.5, clusters: 2 });
    expect(mode?.blockAccuracy?.clusters).toBe(6);
    expect(mode?.passK).toEqual({ k: 3, mean: 0.5 });
  });
});

describe('loadCampaign on a stored Acme campaign', () => {
  it('reads the campaign, its specs and one run per cell in a fixed order', async () => {
    const store = openMemoryStore();
    await storeAcmeCampaign(store, { campaignId: 'c-load', modes: ['F', 'P'], repeats: 2 });
    const data = await loadCampaign(store, 'c-load');
    expect(data.campaign.createdAt).toBe(FIXED);
    expect(data.specs.size).toBe(6);
    const order = data.runs.map(
      (entry) => `${entry.specId} ${entry.mode} ${entry.perturbationId ?? ''} ${entry.repeat}`,
    );
    expect(order.slice(0, 6)).toEqual([
      'acme-new-customer-coverage F  0',
      'acme-new-customer-coverage F  1',
      'acme-new-customer-coverage P shop-hours 0',
      'acme-new-customer-coverage P shop-hours 1',
      'acme-new-customer-coverage P free-fiber 0',
      'acme-new-customer-coverage P free-fiber 1',
    ]);
    expect(new Set(data.runs.map((entry) => entry.runId)).size).toBe(data.runs.length);
    const lines = reliability(data);
    expect(lines.every((entry) => entry.passRate.k === 2 && entry.runs === 2)).toBe(true);
    const recovered = lines.filter((entry) => entry.recovery);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.every((entry) => entry.mode === 'P' && entry.recovery?.labels.immediate === 2)).toBe(
      true,
    );
    await expect(loadCampaign(store)).resolves.toMatchObject({ campaign: { campaignId: 'c-load' } });
    await store.close();
  });

  it('fails with a report input error on a missing campaign or spec', async () => {
    const store = openMemoryStore();
    await expect(loadCampaign(store)).rejects.toBeInstanceOf(ReportInputError);
    await expect(loadCampaign(store, 'nope')).rejects.toThrow('No campaign nope');
    await store.putCampaign({
      campaignId: 'c-missing',
      specs: [{ id: 'gone', hash: 'h0' }],
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: FIXED,
    });
    await expect(loadCampaign(store, 'c-missing')).rejects.toThrow('no spec gone at hash h0');
    await store.close();
  });
});
