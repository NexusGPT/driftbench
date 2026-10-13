import { mulberry32 } from '@agent-nexus/driftbench-stats';

/**
 * The seeded generators the simulation levels draw from. Each level and each design inside it draws from its
 * own stream: the seed mixed with a salt, so two designs never share draws and a repeat run draws the same.
 */

/** The generator of one salt on one seed. Level 2 salts with the sample size; later levels with their own salt. */
export function generator(seed: number, salt: number): () => number {
  return mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
}

/** The salt of a design: its level times 1000000 plus the design's index, apart from level 2's sample sizes. */
export function salt(level: number, index: number): number {
  return 1_000_000 * level + index;
}

/** A standard normal draw (Box-Muller, one of the pair). */
export function normal(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The outcomes of one cluster of `size` binary units with pass rate `rate` and intraclass correlation `rho`:
 * the cluster draws one shared outcome, and each unit copies it with chance sqrt(rho), else draws its own.
 * Two units of one cluster then agree beyond chance exactly as rho says: their correlation is
 * sqrt(rho) squared, and every unit passes with chance `rate`.
 */
export function clusterOutcomes(rng: () => number, size: number, rate: number, rho: number): number[] {
  const copy = Math.sqrt(rho);
  const shared = rng() < rate ? 1 : 0;
  const out: number[] = new Array(size);
  for (let unit = 0; unit < size; unit += 1) out[unit] = rng() < copy ? shared : rng() < rate ? 1 : 0;
  return out;
}
