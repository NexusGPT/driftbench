/**
 * The validator's own mulberry32, the same 32-bit generator as the statistics package's (docs/statistics): the
 * validator draws its inputs from it and must not load the package under test to do so. The bank pins the package's
 * own mulberry32 against published values (reproducibility.mulberry32-pinned), so the two cannot drift unseen.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
