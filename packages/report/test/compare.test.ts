import type { RunResult } from '@driftbench/core';
import { openMemoryStore } from '@driftbench/store';
import { benjaminiHochberg, mcnemar, pairedRateDifference, wilcoxonSignedRank } from '@driftbench/stats';
import { describe, expect, it } from 'vitest';
import { compareCampaigns, criterionOf, unitsOf } from '../src/compare';
import { loadCampaign } from '../src/data';
import { compareText } from '../src/text';
import { dataOf, run, storeAcmeCampaign, verdict } from './support';

/** n goldens, each one run in F; `fails` lists the goldens whose run fails `tools`; `forbidden` the goldens with a forbidden call. */
function campaign(
  id: string,
  n: number,
  options: { fails?: number[]; forbidden?: number[]; drift?: Record<number, number>; specHash?: string } = {},
) {
  const runs: RunResult[] = [];
  for (let i = 0; i < n; i += 1) {
    const fails = options.fails?.includes(i) ?? false;
    const forbidden = options.forbidden?.includes(i) ?? false;
    const drifting = options.drift?.[i] ?? (fails ? 1 : 0);
    runs.push(
      run({
        specId: `g${String(i).padStart(2, '0')}`,
        ...(options.specHash ? { specHash: options.specHash } : {}),
        blocks: Array.from({ length: Math.max(1, drifting) }, (_, b) => ({
          pass: !(fails || forbidden) || b > 0,
          drift: b < drifting ? ['X5_tool' as const] : [],
          verdicts: [
            { id: 'tools.order.count', outcome: fails && b === 0 ? ('fail' as const) : ('pass' as const) },
            { id: 'must.0', outcome: 'pass' as const },
            { id: 'forbidden.order', outcome: forbidden && b === 0 ? ('fail' as const) : ('pass' as const) },
          ],
        })),
      }),
    );
  }
  return dataOf(runs, {}, id);
}

describe('compareCampaigns', () => {
  it('finds a candidate equal to its baseline non-inferior when the goldens are enough for the margin', () => {
    const result = compareCampaigns(campaign('b', 60), campaign('c', 60), { margin: 0.1 });
    expect(result.pairs).toHaveLength(60);
    expect(result.allPass.table).toEqual({ bothPass: 60, regressed: 0, improved: 0, bothFail: 0 });
    const effect = pairedRateDifference({ bothPass: 60, regressed: 0, improved: 0, bothFail: 0 });
    expect(result.allPass.effect).toMatchObject({ estimate: 0, upper: effect.upper, method: 'newcombe' });
    expect(result.allPass.effect.upper).toBeLessThan(0.1);
    expect(result.criteria.map((row) => row.criterion)).toEqual(['forbidden', 'must', 'tools']);
    expect(result.criteria.every((row) => row.nonInferior === true)).toBe(true);
    expect(result.verdict).toBe('non-inferior');
  });

  it('calls the same candidate unproven when the margin is tighter than the goldens can show', () => {
    const result = compareCampaigns(campaign('b', 60), campaign('c', 60), { margin: 0.02 });
    expect(result.verdict).toBe('unproven');
    expect(result.reasons[0]).toContain('all-pass: the upper bound');
  });

  it('detects a planted drop: McNemar on the all-pass flag, and the criterion that carries it after BH', () => {
    const fails = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27];
    const result = compareCampaigns(campaign('b', 60), campaign('c', 60, { fails }), { margin: 0.05 });
    expect(result.allPass.table).toEqual({ bothPass: 50, regressed: 10, improved: 0, bothFail: 0 });
    expect(result.allPass.mcnemar.pValue).toBeCloseTo(mcnemar(10, 0, { exact: true }).pValue, 12);
    expect(result.allPass.effect.estimate).toBeCloseTo(10 / 60, 12);
    const tools = result.criteria.find((row) => row.criterion === 'tools');
    expect(tools).toMatchObject({ regressed: 10, improved: 0, significantRegression: true, nonInferior: false });
    const bh = benjaminiHochberg(result.criteria.map((row) => row.pValue));
    expect(result.criteria.map((row) => row.adjusted)).toEqual(bh.adjusted);
    expect(result.criteria[0]?.criterion).toBe('tools');
    expect(result.verdict).toBe('regressed');
    expect(result.reasons[0]).toContain('all-pass dropped');
  });

  it('keeps a lone criterion regression from being called significant when BH does not reject it', () => {
    const result = compareCampaigns(campaign('b', 60), campaign('c', 60, { fails: [5] }), { margin: 0.05 });
    expect(result.criteria.find((row) => row.criterion === 'tools')?.significantRegression).toBe(false);
    expect(result.verdict).toBe('unproven');
  });

  it('calls a new gating flag a regression even when every rate is within the margin', () => {
    const result = compareCampaigns(campaign('b', 200), campaign('c', 200, { forbidden: [7] }), { margin: 0.2 });
    expect(result.newFlags).toEqual([{ unit: 'g07 · F', family: 'forbidden' }]);
    expect(result.allPass.nonInferior).toBe(true);
    expect(result.verdict).toBe('regressed');
    // A flag the baseline already raised is not new.
    const both = compareCampaigns(campaign('b', 200, { forbidden: [7] }), campaign('c', 200, { forbidden: [7] }), {
      margin: 0.2,
    });
    expect(both.newFlags).toEqual([]);
  });

  it('runs Wilcoxon on the drift count per golden, positive when the candidate drifts more', () => {
    const drift = { 1: 2, 2: 3, 4: 1, 8: 2 };
    const result = compareCampaigns(campaign('b', 20), campaign('c', 20, { drift }), { margin: 0.5 });
    const expected = wilcoxonSignedRank(
      Array.from({ length: 20 }, (_, i) => drift[i as keyof typeof drift] ?? 0),
      Array.from({ length: 20 }, () => 0),
    );
    expect(result.drift.wilcoxon.pValue).toBeCloseTo(expected.pValue, 12);
    expect(result.drift.wilcoxon.rPlus).toBeGreaterThan(result.drift.wilcoxon.rMinus);
    expect(result.drift.candidateMean).toBe(8 / 20);
  });

  it('pairs only the same golden at the same hash, and refuses two campaigns with nothing in common', () => {
    const result = compareCampaigns(campaign('b', 3), dataOf([run({ specId: 'g00', specHash: 'h2' }), run({ specId: 'g01' }), run({ specId: 'x' })], {}, 'c'), {
      margin: 0.5,
    });
    expect(result.pairs.map((pair) => pair.unit)).toEqual(['g01 · F']);
    expect(result.unpaired).toEqual([
      { unit: 'g00 · F', reason: 'the spec changed between the campaigns: h1 and h2' },
      { unit: 'g02 · F', reason: 'baseline only' },
      { unit: 'x · F', reason: 'candidate only' },
    ]);
    expect(() => compareCampaigns(campaign('b', 2), campaign('c', 2, { specHash: 'h9' }), { margin: 0.1 })).toThrow(
      'share no golden',
    );
    expect(() => compareCampaigns(campaign('b', 2), campaign('c', 2), { margin: 0 })).toThrow('margin');
  });

  it('treats a golden as passing only when every repeat passes, and ignores inconclusive verdicts', () => {
    const units = unitsOf(
      [
        run({ repeat: 0, blocks: [{ verdicts: [{ id: 'judge.tone', kind: 'judge', name: 'tone', outcome: 'inconclusive' }] }] }),
        run({ repeat: 1, blocks: [{ pass: false, verdicts: [{ id: 'tools.x', outcome: 'fail' }] }] }),
      ],
      ['forbidden'],
    );
    const side = units.get('spec-a · F')?.side;
    expect(side?.allPass).toBe(false);
    expect(side?.criteria.has('judge.tone')).toBe(false);
    expect(side?.criteria.get('tools')).toEqual({ pass: false, gating: true });
  });

  it('adds the target to the unit when a campaign runs a golden on several targets', () => {
    const units = unitsOf(
      [run(), run({ target: { adapter: 'function', agent: 'other' } }), run({ specId: 'b', mode: 'P', perturbationId: 'p1' })],
      [],
    );
    expect([...units.keys()]).toEqual(['spec-a · F · function:demo', 'spec-a · F · function:other', 'b · P · p1']);
  });

  it('names a criterion by its family, or by its id for a judged one', () => {
    expect(criterionOf(verdict({ id: 'tools.order.create.count' }))).toBe('tools');
    expect(criterionOf(verdict({ id: 'must.3' }))).toBe('must');
    expect(criterionOf(verdict({ id: 'judge.tone', kind: 'judge', name: 'tone' }))).toBe('judge.tone');
  });

  it('compares only the modes asked for', () => {
    const b = dataOf([run({ mode: 'F' }), run({ mode: 'T' })], {}, 'b');
    const c = dataOf([run({ mode: 'F' }), run({ mode: 'T', blocks: [{ pass: false }] })], {}, 'c');
    expect(compareCampaigns(b, c, { margin: 0.5 }).modes).toEqual(['T', 'F']);
    const onlyF = compareCampaigns(b, c, { margin: 0.5, modes: ['F'] });
    expect(onlyF.modes).toEqual(['F']);
    expect(onlyF.pairs.map((pair) => pair.unit)).toEqual(['spec-a · F']);
  });
});

describe('compare on stored Acme campaigns', () => {
  it('finds the fault that skips the recap regressed against the Acme agent', async () => {
    const store = openMemoryStore();
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F', 'P'], repeats: 2 });
    await storeAcmeCampaign(store, { campaignId: 'c-x3', modes: ['F', 'P'], repeats: 2, fault: 'x3-skips-recap' });
    const baseline = await loadCampaign(store, 'c-acme');
    const candidate = await loadCampaign(store, 'c-x3');
    const result = compareCampaigns(baseline, candidate, { margin: 0.15 });
    expect(result.pairs).toHaveLength(16);
    expect(result.allPass.table.regressed).toBeGreaterThan(0);
    expect(result.allPass.table.improved).toBe(0);
    expect(result.verdict).toBe('regressed');
    expect(result.candidate.targets).toEqual(['function:acme-sales (variant fault-x3-skips-recap)']);
    const text = compareText(result);
    expect(text).toContain('Verdict: REGRESSED.');
    expect(text).toContain('McNemar exact p =');
    const same = compareCampaigns(baseline, baseline, { margin: 0.15 });
    expect(same.allPass.table).toMatchObject({ regressed: 0, improved: 0 });
    expect(same.verdict).not.toBe('regressed');
    await store.close();
  }, 60_000);
});
