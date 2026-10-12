import { describe, expect, it } from 'vitest';
import {
  type AggregateCriterion,
  aggregateFromFlag,
  BUILT_IN_AGGREGATES,
  evaluateAggregates,
} from '../src/aggregate';
import { rate } from '../src/estimate';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

const passing = () => run({ blocks: [{ pass: true }, { pass: true }] });
const failing = () => run({ blocks: [{ pass: true }, { pass: false }] });

describe('campaign-level aggregate criteria', () => {
  it('scores a criterion over every run of the campaign, not per block', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.passRate()]);
    expect(result).toMatchObject({ name: 'pass-rate', value: 0.75, passed: true });
  });

  it('applies an at-most threshold to the share of broken runs', () => {
    const broken = run({ status: 'failed', blocks: [{ pass: false }] });
    const data = dataOf([passing(), passing(), passing(), broken]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.brokenShare(0.2)]);
    expect(result).toMatchObject({ name: 'broken-share', value: 0.25, passed: false, direction: 'at-most' });
  });

  it('is inconclusive, not failed, for a campaign with no runs', () => {
    const [result] = evaluateAggregates(dataOf([]), [BUILT_IN_AGGREGATES.passRate()]);
    expect(result).toMatchObject({ value: undefined, passed: undefined });
    expect(result?.reason).toContain('no runs');
  });

  it('evaluates a custom criterion over the whole campaign', () => {
    const custom: AggregateCriterion = {
      name: 'runs-with-two-blocks',
      threshold: 0.5,
      direction: 'at-least',
      measure: (data) => data.runs.filter((entry) => entry.blocks.length === 2).length / data.runs.length,
    };
    const data = dataOf([passing(), failing(), run({ blocks: [{ pass: true }] })]);
    const [result] = evaluateAggregates(data, [custom]);
    expect(result).toMatchObject({ value: 2 / 3, passed: true });
  });

  it('adds aggregates to the scorecard only when they are asked for', () => {
    const data = dataOf([passing(), failing()]);
    expect(buildScorecard(data).aggregates).toBeUndefined();
    const card = buildScorecard(data, { aggregates: [BUILT_IN_AGGREGATES.passRate(0.4)] });
    expect(card.aggregates?.[0]).toMatchObject({ name: 'pass-rate', value: 0.5, passed: true });
  });
});

describe('aggregate flag syntax', () => {
  it('reads name:op threshold, where the operator sets the direction', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [atLeast] = evaluateAggregates(data, [aggregateFromFlag('pass-rate:>=0.7')]);
    expect(atLeast).toMatchObject({ name: 'pass-rate', direction: 'at-least', threshold: 0.7, passed: true });
    const [atMost] = evaluateAggregates(data, [aggregateFromFlag('broken-share:<=0.1')]);
    expect(atMost).toMatchObject({
      name: 'broken-share',
      direction: 'at-most',
      threshold: 0.1,
      passed: true,
    });
  });

  it('refuses an unknown name, a missing operator, and a threshold that is not a number', () => {
    expect(() => aggregateFromFlag('nope:>=0.5')).toThrow(/unknown aggregate/);
    expect(() => aggregateFromFlag('pass-rate0.5')).toThrow(/name:op threshold/);
    expect(() => aggregateFromFlag('pass-rate:>=lots')).toThrow(/threshold/);
  });
});

describe('aggregate intervals and planning numbers', () => {
  it('reports the Wilson interval of the rate, the same interval the report uses', () => {
    const data = dataOf([passing(), passing(), passing(), failing()]);
    const [result] = evaluateAggregates(data, [BUILT_IN_AGGREGATES.passRate()]);
    expect(result?.interval).toEqual({ lower: rate(3, 4)?.lower, upper: rate(3, 4)?.upper, n: 4 });
  });

  it('says a criterion is decided when its interval clears the threshold, with no runs needed', () => {
    const runs = [
      ...Array.from({ length: 90 }, () => passing()),
      ...Array.from({ length: 10 }, () => failing()),
    ];
    const [result] = evaluateAggregates(dataOf(runs), [BUILT_IN_AGGREGATES.passRate(0.8)]);
    expect(result).toMatchObject({ passed: true, decided: true });
    expect(result?.runsNeeded).toBeUndefined();
  });

  it('says how many runs at the same rate would decide an undecided criterion', () => {
    const [result] = evaluateAggregates(dataOf([passing(), passing(), passing(), failing()]), [
      BUILT_IN_AGGREGATES.passRate(0.7),
    ]);
    expect(result).toMatchObject({ passed: true, decided: false });
    const needed = result?.runsNeeded ?? 0;
    expect(needed).toBeGreaterThan(4);
    const k = Math.round(0.75 * needed);
    expect((rate(k, needed)?.lower ?? 0) >= 0.7).toBe(true);
  });
});
