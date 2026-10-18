import { passAtK, passK } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { incompleteRange, withheldAtK } from '../src/reliability';

describe('incompleteRange: the value counts incomplete runs as failing; the interval covers both outcomes', () => {
  it('with no incomplete run, the range is the value itself', () => {
    expect(incompleteRange(2, 3, 0, 2, passAtK)).toEqual({
      value: passAtK(2, 3, 2),
      lower: passAtK(2, 3, 2),
      upper: passAtK(2, 3, 2),
    });
  });

  it('with one incomplete run, the lower end is all missing runs failing and the upper all passing', () => {
    const range = incompleteRange(1, 3, 1, 2, passAtK);
    expect(range.value).toBe(passAtK(1, 3, 2));
    expect(range.lower).toBe(passAtK(1, 3, 2));
    expect(range.upper).toBe(passAtK(2, 3, 2));
    expect(range.lower).toBeLessThanOrEqual(range.value);
    expect(range.value).toBeLessThanOrEqual(range.upper);
  });

  it('for pass^k the same two outcomes bound the value', () => {
    const range = incompleteRange(2, 4, 2, 2, passK);
    expect(range.lower).toBe(passK(2, 4, 2));
    expect(range.upper).toBe(passK(4, 4, 2));
  });
});

describe('withheldAtK: the withhold policy returns no value for a line with incomplete runs', () => {
  it('withholds only when the policy says withhold and the line has incomplete runs', () => {
    expect(withheldAtK(0, 'withhold')).toBe(false);
    expect(withheldAtK(2, 'interval')).toBe(false);
    expect(withheldAtK(2, 'withhold')).toBe(true);
  });
});

import { reliability } from '../src/reliability';
import { dataOf, run } from './support';

describe('reliability lines with incomplete runs', () => {
  // Three runs of one golden: two complete and pass, one never completed.
  const runs = [
    run({ repeat: 0, blocks: [{}] }),
    run({ repeat: 1, blocks: [{}] }),
    run({ repeat: 2, status: 'failed', blocks: [] }),
  ];

  it('flags the line, keeps the value as before, and widens each k to both outcomes of the missing run', () => {
    const [line] = reliability(dataOf(runs), 'interval');
    expect(line?.incomplete).toBe(1);
    expect(line?.withheld).toBeUndefined();
    const k2 = line?.passAtK.find((row) => row.k === 2);
    expect(k2?.value).toBeCloseTo(passAtK(2, 3, 2), 12);
    expect(k2?.incomplete).toBe(true);
    expect(k2?.upper).toBeGreaterThanOrEqual(passAtK(3, 3, 2));
  });

  it('withhold leaves no at-k value on the line and marks it withheld', () => {
    const [line] = reliability(dataOf(runs), 'withhold');
    expect(line?.withheld).toBe(true);
    expect(line?.passK).toEqual([]);
    expect(line?.passAtK).toEqual([]);
    expect(line?.incomplete).toBe(1);
  });
});
