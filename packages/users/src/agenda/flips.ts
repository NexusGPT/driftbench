/**
 * Repeated simulated runs: pass^k per block, the rerun flip rate, and the flip flag.
 *
 * A simulated verdict can change on a plain rerun of the same simulator: H11 (block-sim research branch)
 * found a cross-family flip share of 0.15 against a within-family rerun share of 0.20. So a block is flagged
 * as simulator-sensitive only when its cross-family flip rate exceeds its own rerun flip rate AND the two
 * families' pass counts differ beyond chance (Fisher's exact test, two-sided, at `alpha`). The rerun rate
 * alone is the baseline; the test keeps one disagreeing trial in eight from raising a block.
 */

/** pass^k: the chance that k trials drawn without replacement from n, c of which passed, all pass. */
export function passHatK(n: number, c: number, k: number): number | undefined {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k) || k < 1 || c < 0 || c > n)
    throw new RangeError(
      `passHatK needs whole numbers with 0 <= c <= n and k >= 1, not n=${n} c=${c} k=${k}`,
    );
  if (n < k) return undefined;
  return choose(c, k) / choose(n, k);
}

/** The chance that two different trials of one simulator disagree: 2c(n-c) / (n(n-1)). */
export function rerunFlipRate(outcomes: readonly boolean[]): number | undefined {
  const n = outcomes.length;
  if (n < 2) return undefined;
  const c = outcomes.filter(Boolean).length;
  return (2 * c * (n - c)) / (n * (n - 1));
}

/** The chance that a trial of one family and a trial of the other disagree. */
export function crossFlipRate(a: readonly boolean[], b: readonly boolean[]): number | undefined {
  if (a.length === 0 || b.length === 0) return undefined;
  const pa = a.filter(Boolean).length / a.length;
  const pb = b.filter(Boolean).length / b.length;
  return pa * (1 - pb) + pb * (1 - pa);
}

/** Fisher's exact test, two-sided, on passes and fails of two groups. */
export function fisherExact(passA: number, nA: number, passB: number, nB: number): number {
  const passes = passA + passB;
  const total = nA + nB;
  const probability = (x: number) => (choose(passes, x) * choose(total - passes, nA - x)) / choose(total, nA);
  const observed = probability(passA);
  let p = 0;
  for (let x = Math.max(0, nA - (total - passes)); x <= Math.min(nA, passes); x += 1) {
    const each = probability(x);
    if (each <= observed * (1 + 1e-9)) p += each;
  }
  return Math.min(1, p);
}

export type FamilyTrials = Readonly<Record<string, readonly boolean[]>>;

export type BlockFlips = {
  block: string;
  /** Per family: trials, passes, pass^k, the rerun flip rate. */
  families: Record<string, { trials: number; passes: number; passHatK?: number; rerunFlipRate?: number }>;
  /** The mean of the families' rerun flip rates. */
  rerunFlipRate?: number;
  /** The mean cross-family flip rate over every pair of families. */
  crossFlipRate?: number;
  /** The smallest Fisher p over the pairs. */
  p?: number;
  flagged: boolean;
  /** The pairs that raised the flag, `a/b`. */
  pairs: string[];
};

export type FlipOptions = { k?: number; alpha?: number };

/**
 * The flip report of one block. A pair of families raises the flag when its cross-family flip rate is
 * above the mean of the two rerun flip rates and Fisher's p is below `alpha` (0.05 by default).
 */
export function blockFlips(block: string, trials: FamilyTrials, options: FlipOptions = {}): BlockFlips {
  const k = options.k ?? 4;
  const alpha = options.alpha ?? 0.05;
  const names = Object.keys(trials).sort();
  const families: BlockFlips['families'] = {};
  for (const name of names) {
    const outcomes = trials[name] ?? [];
    const passes = outcomes.filter(Boolean).length;
    const hat = outcomes.length === 0 ? undefined : passHatK(outcomes.length, passes, k);
    const rerun = rerunFlipRate(outcomes);
    families[name] = {
      trials: outcomes.length,
      passes,
      ...(hat === undefined ? {} : { passHatK: hat }),
      ...(rerun === undefined ? {} : { rerunFlipRate: rerun }),
    };
  }
  const reruns = names.map((name) => families[name]?.rerunFlipRate).filter((rate) => rate !== undefined);
  const crosses: number[] = [];
  const ps: number[] = [];
  const pairs: string[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i] as string;
      const b = names[j] as string;
      const ta = trials[a] ?? [];
      const tb = trials[b] ?? [];
      const cross = crossFlipRate(ta, tb);
      const ra = families[a]?.rerunFlipRate;
      const rb = families[b]?.rerunFlipRate;
      if (cross === undefined || ra === undefined || rb === undefined) continue;
      crosses.push(cross);
      const p = fisherExact(families[a]?.passes ?? 0, ta.length, families[b]?.passes ?? 0, tb.length);
      ps.push(p);
      if (cross > (ra + rb) / 2 + 1e-12 && p < alpha) pairs.push(`${a}/${b}`);
    }
  }
  return {
    block,
    families,
    ...(reruns.length === 0 ? {} : { rerunFlipRate: mean(reruns) }),
    ...(crosses.length === 0 ? {} : { crossFlipRate: mean(crosses) }),
    ...(ps.length === 0 ? {} : { p: Math.min(...ps) }),
    flagged: pairs.length > 0,
    pairs,
  };
}

/** The flip report of every block: `{ block: { family: [pass, ...] } }`. */
export function flipReport(
  trials: Readonly<Record<string, FamilyTrials>>,
  options: FlipOptions = {},
): BlockFlips[] {
  return Object.keys(trials)
    .sort()
    .map((block) => blockFlips(block, trials[block] ?? {}, options));
}

/**
 * The suite-level shares H11 registered: trials split into batches of k, each batch a pass^k verdict
 * (all k passed); X is the mean cross-family verdict disagreement over every batch pair, W the mean
 * within-family disagreement between a family's two batches. Two families, 2k trials each.
 */
export function batchFlipShares(
  trials: Readonly<Record<string, FamilyTrials>>,
  families: readonly [string, string],
  k = 4,
): { cross: number; within: number } {
  const blocks = Object.keys(trials).sort();
  const verdict = (outcomes: readonly boolean[], batch: 0 | 1) =>
    outcomes.slice(batch * k, (batch + 1) * k).every(Boolean) ? 1 : 0;
  const [f1, f2] = families;
  let cross = 0;
  let within = 0;
  for (const block of blocks) {
    const a = trials[block]?.[f1] ?? [];
    const b = trials[block]?.[f2] ?? [];
    for (const x of [0, 1] as const)
      for (const y of [0, 1] as const) cross += Number(verdict(a, x) !== verdict(b, y)) / 4;
    within += (Number(verdict(a, 0) !== verdict(a, 1)) + Number(verdict(b, 0) !== verdict(b, 1))) / 2;
  }
  return { cross: cross / blocks.length, within: within / blocks.length };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= Math.min(k, n - k); i += 1) out = (out * (n - Math.min(k, n - k) + i)) / i;
  return out;
}
