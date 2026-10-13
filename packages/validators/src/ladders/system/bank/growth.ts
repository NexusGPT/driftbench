import { fail, type ItemResult, PASS } from './types';

/**
 * The growth measure of a conversation that gets longer, as `scale.ts` has taken it so far, moved here
 * unchanged so its tests can drive it: one run at one, ten and a hundred times the base size, the ten-times
 * size timed twice more and the hundred-times size once more when it looks too slow, each keeping its
 * fastest time, and the ratio of the two against the bound.
 */

/** The CPU time this process has used, user plus system, in milliseconds. */
export function cpuClock(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

export type GrowthOptions = {
  /** The CPU clock, in milliseconds. A test gives its own. */
  clock?: () => number;
  /** The rounds of timing. Not read yet. */
  rounds?: { min: number; max: number };
  /** The bound of the time growth: the bank's GROWTH_BOUND. */
  timeBound: number;
};

export type Growth = { result: ItemResult };

export async function measureGrowth(
  run: (size: number) => Promise<unknown>,
  base: number,
  options: GrowthOptions,
): Promise<Growth> {
  const clock = options.clock ?? cpuClock;
  const timed = async (size: number): Promise<number> => {
    const started = clock();
    await run(size);
    return clock() - started;
  };
  await timed(base);
  let ten = await timed(base * 10);
  let hundred = await timed(base * 100);
  for (let again = 0; again < 2; again += 1) ten = Math.min(ten, await timed(base * 10));
  if (hundred / Math.max(ten, 1) > options.timeBound) hundred = Math.min(hundred, await timed(base * 100));
  const growth = hundred / Math.max(ten, 1);
  return {
    result:
      growth <= options.timeBound
        ? PASS
        : fail(
            `${Math.round(ten)} ms at ${base * 10}, ${Math.round(hundred)} ms at ${base * 100}: ${growth.toFixed(1)} times`,
          ),
  };
}
