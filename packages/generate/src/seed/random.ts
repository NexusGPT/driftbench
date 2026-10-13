import { seededRandom } from '@agent-nexus/driftbench-space';

/**
 * Seeded choice for the seeders. Every random draw comes from a stream named by the run seed and a label
 * (the seeder and the unit it builds), so one seeder's draws never shift another's and the same map with
 * the same seed gives the same suite, byte for byte.
 */

export type Rng = () => number;

/** The integer seed of a named stream: FNV-1a over the run seed and the label, 32 bits. */
export function streamSeed(seed: number, label: string): number {
  let hash = 0x811c9dc5;
  const text = `${seed}:${label}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A random stream for one label of one run. */
export function rngFor(seed: number, label: string): Rng {
  return seededRandom(streamSeed(seed, label));
}

/** One item, chosen by the stream; undefined for an empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** A shuffled copy (Fisher and Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    const held = out[index] as T;
    out[index] = out[other] as T;
    out[other] = held;
  }
  return out;
}

/** 0, 1, ..., n - 1. */
export function range(n: number): number[] {
  return Array.from({ length: n }, (_, index) => index);
}
