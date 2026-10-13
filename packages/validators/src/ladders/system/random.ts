import { mulberry32 } from '@agent-nexus/driftbench-stats';

/**
 * Seeded draws for the system validator. Every draw of a plant comes from one generator per purpose, mixed
 * from the validator seed and a fixed tag, so adding a draw to one purpose never moves the draws of another.
 */
export type Rng = () => number;

/** A generator for one purpose of one seed: the seed mixed with the tag's hash. */
export function rngFor(seed: number, tag: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ hash) >>> 0);
}

/** An integer drawn uniformly from low to high, both included. */
export function between(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1));
}

/** One element drawn uniformly. Throws on an empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: no item to draw from');
  return items[Math.floor(rng() * items.length)] as T;
}

/** The items in a seeded order (Fisher and Yates). */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}
