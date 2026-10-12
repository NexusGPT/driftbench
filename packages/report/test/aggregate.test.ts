import { describe, expect, it } from 'vitest';
import { type AggregateCriterion, BUILT_IN_AGGREGATES, evaluateAggregates } from '../src/aggregate';
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
