/**
 * The cost of one generation of a planted product, in milliseconds of fake CPU, as a function of the number of
 * behaviours `n` its map holds. A test imports this module for the arithmetic only; it changes nothing in the
 * process, unlike `metered-product.ts`, which replaces the CPU meter of the child that loads it.
 *
 * - `linear` is 20,000 n.
 * - `slow` is 40,000 n, twice the linear product at every n.
 * - `quadratic` is 2,000 n squared.
 * - `nlogn` is 20,000 n log2 n.
 *
 * The sizes are those of a real 100 times run (tens of seconds), so a budget made of them is also a wall-clock
 * cap the real work under the fake meter stays far below.
 */
export function costOf(shape: string, behaviours: number): number {
  switch (shape) {
    case 'linear':
      return 20_000 * behaviours;
    case 'slow':
      return 40_000 * behaviours;
    case 'quadratic':
      return 2_000 * behaviours * behaviours;
    case 'nlogn':
      return 20_000 * behaviours * Math.log2(behaviours);
    default:
      throw new Error(`unknown METERED_SHAPE ${shape}`);
  }
}
