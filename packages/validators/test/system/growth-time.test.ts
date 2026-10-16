import { describe, expect, it } from 'vitest';
import { MAX_SAMPLE_RUNS, MIN_SAMPLE_MS, measureTimeGrowth } from '../../src/ladders/system/bank/growth';
import { GROWTH_BOUND } from '../../src/ladders/system/bank/scale';

/**
 * The time measure of the subjects that are not a history. A fake clock gives each run a cost, so a test says
 * exactly what the measure reads; the last test uses the real clock on loops written here.
 */

type Cost = (size: number, call: number) => number;

/** A subject whose run at `size` costs `cost(size, call)` ms, where `call` counts the runs at that size. */
function fake(cost: Cost) {
  let now = 0;
  const calls = new Map<number, number>();
  return {
    clock: () => now,
    run: async (size: number) => {
      const call = calls.get(size) ?? 0;
      calls.set(size, call + 1);
      now += cost(size, call);
    },
  };
}

const options = (subject: { clock: () => number }) => ({ timeBound: GROWTH_BOUND, clock: subject.clock });

describe('measureTimeGrowth: sampling', () => {
  it('reads a run of 2 ms over a sample of at least the minimum, not over one tick', async () => {
    const subject = fake((size) => (size === 100 ? 2 : 20));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.runs * 2).toBeGreaterThanOrEqual(MIN_SAMPLE_MS);
    expect(growth.time.ten).toBe(2);
    expect(growth.time.hundred).toBe(20);
    expect(growth.result).toEqual({ pass: true });
  });

  it('takes the best of three samples at each size', async () => {
    // The first sample of the smaller size and the first two of the larger size are hit by load.
    const subject = fake((size, call) => (size === 100 ? (call < 40 ? 9 : 2) : call < 2 ? 190 : 20));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.hundred).toBe(20);
    expect(growth.result).toEqual({ pass: true });
  });

  it('stops doubling the runs of a sample at the most', async () => {
    const subject = fake(() => 0);
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.time.runs).toBe(MAX_SAMPLE_RUNS);
  });
});

describe('measureTimeGrowth: the bound of the bank is kept', () => {
  it('fails 26 times and passes 24 times at the bound of 25', async () => {
    expect(GROWTH_BOUND).toBe(25);
    const over = fake((size) => (size === 100 ? 2 : 52));
    const under = fake((size) => (size === 100 ? 2 : 48));
    const failed = await measureTimeGrowth(over.run, 10, options(over));
    const passed = await measureTimeGrowth(under.run, 10, options(under));
    expect(failed.result.pass).toBe(false);
    expect(failed.result.pass ? '' : failed.result.detail).toContain('26.0 times');
    expect(passed.result).toEqual({ pass: true });
  });

  it('does not floor the smaller time at one millisecond', async () => {
    // 0.2 ms at the smaller size and 8 ms at the larger one is 40 times. A floor of 1 ms would call it 8.
    const subject = fake((size) => (size === 100 ? 0.2 : 8));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.result.pass).toBe(false);
  });

  it('fails a quadratic run however the samples fall', async () => {
    const subject = fake((size, call) => (size === 100 ? 2 + (call % 3) : 200 + (call % 5) * 40));
    const growth = await measureTimeGrowth(subject.run, 10, options(subject));
    expect(growth.result.pass).toBe(false);
  });
});

describe('measureTimeGrowth: the real clock', () => {
  const sink = { total: 0 };
  /** A run whose work is `perUnit` operations for each of `size` units. */
  const linear = async (size: number) => {
    for (let index = 0; index < size * 400; index += 1) sink.total += index % 7;
  };
  /** A run that compares every unit with every other unit: the planted quadratic. */
  const quadratic = async (size: number) => {
    for (let outer = 0; outer < size; outer += 1)
      for (let inner = 0; inner < size * 4; inner += 1) sink.total += (outer ^ inner) % 7;
  };

  it('passes a linear run', async () => {
    const growth = await measureTimeGrowth(linear, 10, { timeBound: GROWTH_BOUND });
    expect(growth.result).toEqual({ pass: true });
  });

  it('fails a planted quadratic run', async () => {
    const growth = await measureTimeGrowth(quadratic, 10, { timeBound: GROWTH_BOUND });
    expect(growth.result.pass).toBe(false);
    expect(growth.time.growth).toBeGreaterThan(GROWTH_BOUND);
  });
}, 60_000);
