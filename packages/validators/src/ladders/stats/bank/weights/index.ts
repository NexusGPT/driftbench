import { type BankItem, exported, fail, type ItemOutcome, ok, show, type Tier } from '../item';

/**
 * The weights lane (board row "Version the statistics validator for weights"): four families on how the
 * statistics package weighs. Every answer comes from a reference written here that never calls the package:
 * exact rationals (BigInt) for the agreement measures and the planted counts, a cancellation-free form for the
 * Wilson bound next to 1, and brute-force enumeration for coverage.
 *
 * - weights-agreement: `cohenKappa` with `linear` and `quadratic` weights over the order `categories` gives,
 *   unseen categories included, and `krippendorffAlpha` at the nominal and interval levels with missing
 *   values (docs/concepts/statistics.md, "Judges").
 * - weights-wilson: `wilson(k, n, z)` next to 1, where the lower bound is a difference of nearly equal numbers
 *   (docs/concepts/statistics.md, "Intervals"; the accuracy bar of docs/statistics/capabilities.md,
 *   "Conventions": a relative 1e-11, and no difference of nearly equal numbers when the formula allows another
 *   way).
 * - weights-mixture: `mixtureWeights(components, counts)`, the maximum-likelihood weights of a mixture of known
 *   category distributions, recovered from counts planted as an exact mix. Not built and not on a page yet: the
 *   contract is the one written below, owed to docs/statistics/ (the page owner writes it).
 * - weights-coverage: `mixedStrengthCoverage(rows, groups, levels)`, the share of the value tuples each group of
 *   axes asks at its own strength that a suite of rows holds. Not built and not on a page yet: the contract
 *   below, owed to docs/statistics/ as well.
 *
 * Mixture and coverage are at the `capabilities` level (the functions are missing from the package; the item fails
 * with the signature to add); agreement and Wilson are at the `analytic` level.
 */

const DOC_JUDGES = 'docs/concepts/statistics.md, "Judges"';
const DOC_INTERVALS =
  'docs/concepts/statistics.md, "Intervals", with docs/statistics/capabilities.md, "Conventions", "Accuracy"';
const DOC_OWED =
  'contract in packages/validators/src/ladders/stats/bank/weights/index.ts, owed to docs/statistics/';

/**
 * The contract of `mixtureWeights` (owed to a page):
 * `mixtureWeights(components: number[][], counts: number[], options?: { tolerance?: number; maxIterations?: number })`
 * returns `{ weights: number[], iterations: number, logLikelihood: number }`. `components` holds m rows, each a
 * probability vector over the same c categories (entries in [0, 1], each row summing to 1 within 1e-12);
 * `counts` holds c counts. `weights` are the m mixture weights (non-negative, summing to 1) that maximise the
 * multinomial log-likelihood `sum_i counts_i log(sum_j w_j components_j_i)`, found by expectation-maximisation
 * from equal weights until no weight moves more than `tolerance` (default 1e-12) or `maxIterations` (default
 * 100000) is reached. When the observed shares are a mix of linearly independent components, the result is that
 * mix. `logLikelihood` is the value at the returned weights. A `RangeError` for: no component, a component of
 * another length than `counts`, an entry outside [0, 1] or a row not summing to 1, a count that is not a
 * non-negative integer, and counts that are all 0. The message of a `RangeError` starts with `mixtureWeights` and names
 * the argument to fix (`components` or `counts`).
 *
 * The contract of `mixedStrengthCoverage` (owed to a page):
 * `mixedStrengthCoverage(rows: number[][], groups: { axes: number[]; strength: number }[], levels: number[])`
 * returns `{ groups: { covered: number; required: number; coverage: number }[], covered, required, coverage }`.
 * `levels[a]` is the number of values of axis a; a row gives one value index per axis, from 0. For a group, the
 * required tuples are every choice of `strength` distinct axes of the group with every combination of their
 * values; a tuple is covered when some row holds those values on those axes. `coverage` is covered over
 * required; the totals add the groups (a tuple asked by two groups counts in each). A `RangeError` for: no
 * group, a row of another length than `levels`, a value that is not an integer in [0, levels[a] - 1], a level
 * count that is not a positive integer, an axis out of range or repeated in a group, and a strength below 1 or
 * above the group's axis count. The message of a `RangeError` starts with `mixedStrengthCoverage` and names the
 * argument to fix (`rows`, `groups` or `levels`).
 */

// ---------------------------------------------------------------------------------------------------------
// Exact rationals.

type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const q = (n: bigint, d: bigint = 1n): Q => {
  if (d < 0n) return q(-n, -d);
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
/** A rational as the nearest binary64, through 40 significant digits. */
function toNumber(a: Q): number {
  if (a.n === 0n) return 0;
  const neg = a.n < 0n;
  const num = neg ? -a.n : a.n;
  const scale = 10n ** 40n;
  const digits = (num * scale) / a.d;
  const value = Number(digits.toString()) / 1e40;
  return neg ? -value : value;
}
const relNear = (got: number, want: number, rel: number): boolean =>
  typeof got === 'number' && Math.abs(got - want) <= rel * Math.max(Math.abs(want), 1e-300);

function item(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  cause: string,
  check: BankItem['check'],
): BankItem {
  // Mixture and coverage test functions the package lacks: the `capabilities` level. Agreement and Wilson test
  // functions it has: `analytic`.
  const level = family === 'weights-mixture' || family === 'weights-coverage' ? 'capabilities' : 'analytic';
  return { id: `weights.${id}`, family, tier, level, component, cause, check };
}

/**
 * The shape of a mixture result: exactly one weight per component, each a finite number in [0, 1], summing to 1.
 * Every mixture item checks this before it compares values, so an extra, a missing or an unnormalised weight fails.
 */
function weightsShape(weights: unknown, m: number): string | undefined {
  if (!Array.isArray(weights)) return 'the result has no weights array';
  if (weights.length !== m) return `the result has ${weights.length} weights for ${m} components`;
  if (weights.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1))
    return 'a weight is not a finite number in [0, 1]';
  const sum = (weights as number[]).reduce((x, y) => x + y, 0);
  if (!(Math.abs(sum - 1) <= 1e-9)) return `the weights sum to ${sum}, not 1`;
  return undefined;
}

/** A refusal passes when its message starts with the function and names the argument to fix. */
function messageNames(message: string, fn: string, argument: string): ItemOutcome {
  // The singular stem counts: "component 0 sums to 0.9" names `components`.
  const stem = argument.replace(/s$/, '');
  return message.startsWith(fn) && message.includes(stem)
    ? ok()
    : fail(
        `the RangeError says ${show(message)}, want it to start with ${fn} and name the argument ${argument}`,
      );
}

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

// ---------------------------------------------------------------------------------------------------------
// weights-agreement

/** Exact weighted (or unweighted) Cohen's kappa over the given category order. */
function kappaRef(
  a: number[],
  b: number[],
  categories: number[],
  weights: 'none' | 'linear' | 'quadratic',
): Q {
  const k = categories.length;
  const at = new Map(categories.map((c, i) => [c, i]));
  const t = Array.from({ length: k }, () => new Array<bigint>(k).fill(0n));
  a.forEach((x, i) => {
    const r = at.get(x) as number;
    const c = at.get(b[i] as number) as number;
    (t[r] as bigint[])[c] = ((t[r] as bigint[])[c] as bigint) + 1n;
  });
  const n = BigInt(a.length);
  const rows = t.map((row) => row.reduce((s, v) => s + v, 0n));
  const cols = categories.map((_, c) => t.reduce((s, row) => s + (row[c] as bigint), 0n));
  if (weights === 'none') {
    let diag = 0n;
    let chance = 0n;
    for (let i = 0; i < k; i += 1) {
      diag += (t[i] as bigint[])[i] as bigint;
      chance += (rows[i] as bigint) * (cols[i] as bigint);
    }
    return q(n * diag - chance, n * n - chance);
  }
  let observed = 0n;
  let expected = 0n;
  for (let i = 0; i < k; i += 1)
    for (let j = 0; j < k; j += 1) {
      const d = BigInt(Math.abs(i - j));
      const w = weights === 'linear' ? d : d * d;
      observed += w * ((t[i] as bigint[])[j] as bigint);
      expected += w * (rows[i] as bigint) * (cols[j] as bigint);
    }
  return expected === 0n ? q(1n) : sub(q(1n), q(n * observed, expected));
}

type AlphaLevel = 'nominal' | 'interval' | 'ordinal' | 'ratio';

/**
 * Exact Krippendorff's alpha from its definition over pairable values (positive integer values), with the
 * difference function of each level: nominal 0 or 1, interval (x - y)^2, ratio ((x - y) / (x + y))^2, and ordinal
 * (the number of pairable values from x to y, less half of the counts of x and y)^2.
 */
function alphaRef(matrix: Array<Array<number | null | undefined>>, level: AlphaLevel): Q | undefined {
  const units = Math.max(...matrix.map((row) => row.length));
  const unitsValues: number[][] = [];
  for (let u = 0; u < units; u += 1) {
    const vals = matrix.map((row) => row[u]).filter((v): v is number => v !== null && v !== undefined);
    if (vals.length >= 2) unitsValues.push(vals);
  }
  const pool = unitsValues.flat();
  const distinct = [...new Set(pool)].sort((x, y) => x - y);
  const count = new Map(distinct.map((v) => [v, pool.filter((x) => x === v).length]));
  const delta = (x: number, y: number): Q => {
    if (x === y) return q(0n);
    if (level === 'nominal') return q(1n);
    if (level === 'interval') return q(BigInt((x - y) * (x - y)));
    if (level === 'ratio') return q(BigInt((x - y) * (x - y)), BigInt((x + y) * (x + y)));
    const lo = Math.min(x, y);
    const hi = Math.max(x, y);
    const between2 = distinct
      .filter((v) => v >= lo && v <= hi)
      .reduce((sum, v) => sum + (count.get(v) as number), 0);
    const half = q(BigInt(2 * between2 - (count.get(x) as number) - (count.get(y) as number)), 2n);
    return mul(half, half);
  };
  let disagreement = q(0n);
  for (const vals of unitsValues) {
    let sum = q(0n);
    for (let i = 0; i < vals.length; i += 1)
      for (let j = 0; j < vals.length; j += 1)
        if (i !== j) sum = add(sum, delta(vals[i] as number, vals[j] as number));
    disagreement = add(disagreement, div(sum, q(BigInt(vals.length - 1))));
  }
  const n = BigInt(pool.length);
  let chance = q(0n);
  for (let i = 0; i < pool.length; i += 1)
    for (let j = 0; j < pool.length; j += 1)
      if (i !== j) chance = add(chance, delta(pool[i] as number, pool[j] as number));
  if (chance.n === 0n) return undefined;
  return sub(q(1n), div(mul(q(n - 1n), disagreement), chance));
}

function agreementItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'weights-agreement';
  for (const weights of ['linear', 'quadratic', 'none'] as const)
    for (const k of [3, 4, 5, 6, 7])
      for (const shape of ['unseen-middle', 'reversed-order'] as const) {
        const id = `kappa.${weights}.${k}.${shape}`;
        out.push(
          item(
            id,
            family,
            (k > 5 ? 3 : 2) as Tier,
            'packages/stats/src/agreement.ts',
            'cohenKappa does not weigh disagreements by |i - j| or (i - j)^2 over the order categories gives',
            ({ s, rng }) => {
              // Two raters over k ordered categories; one middle category is never used when the shape asks it,
              // so the distances run over the given order, never over the labels seen.
              const categories = Array.from({ length: k }, (_, i) => 10 * (i + 1) + between(rng, 0, 9));
              const unused = shape === 'unseen-middle' ? between(rng, 1, k - 2) : -1;
              const usable = categories.filter((_, i) => i !== unused);
              const n = between(rng, 30, 120);
              const a: number[] = [];
              const b: number[] = [];
              for (let i = 0; i < n; i += 1) {
                const x = between(rng, 0, usable.length - 1);
                const drift = rng() < 0.6 ? 0 : between(rng, -2, 2);
                const y = Math.min(usable.length - 1, Math.max(0, x + drift));
                a.push(usable[x] as number);
                b.push(usable[y] as number);
              }
              const order = shape === 'reversed-order' ? [...categories].reverse() : categories;
              const want = toNumber(kappaRef(a, b, order, weights));
              let got: number;
              try {
                got = s.cohenKappa(a, b, { weights, categories: order }).kappa;
              } catch (cause) {
                return fail(`cohenKappa(…, { weights: '${weights}', categories }) threw ${String(cause)}`);
              }
              return relNear(got, want, 1e-11)
                ? ok()
                : fail(
                    `cohenKappa over ${n} items, ${k} categories (${shape}), weights ${weights}: got ${got}, which differs from the reference by more than a relative 1e-11 (${DOC_JUDGES})`,
                  );
            },
          ),
        );
      }
  for (const level of ['nominal', 'interval'] as const)
    for (const raters of [2, 3, 4])
      for (const missing of ['none', 'some'] as const) {
        const id = `alpha.${level}.${raters}.${missing}`;
        out.push(
          item(
            id,
            family,
            (missing === 'some' ? 3 : 2) as Tier,
            'packages/stats/src/agreement.ts',
            'krippendorffAlpha differs from its definition over the pairable values of a matrix with missing values',
            ({ s, rng }) => {
              const units = between(rng, 12, 40);
              const values = between(rng, 3, 6);
              const matrix: Array<Array<number | null | undefined>> = Array.from(
                { length: raters },
                () => [],
              );
              for (let u = 0; u < units; u += 1) {
                const truth = between(rng, 1, values);
                for (let r = 0; r < raters; r += 1) {
                  const gone = missing === 'some' && rng() < 0.3;
                  const v = rng() < 0.7 ? truth : between(rng, 1, values);
                  (matrix[r] as Array<number | null | undefined>).push(gone ? null : v);
                }
              }
              const want = alphaRef(matrix, level);
              if (want === undefined) return ok('no expected disagreement on this draw');
              let got: number;
              try {
                got = s.krippendorffAlpha(matrix, { level }).alpha;
              } catch (cause) {
                return fail(`krippendorffAlpha(matrix, { level: '${level}' }) threw ${String(cause)}`);
              }
              return relNear(got, toNumber(want), 1e-11)
                ? ok()
                : fail(
                    `krippendorffAlpha over ${raters} raters and ${units} units (${missing} missing), level ${level}: got ${got}, which differs from the reference by more than a relative 1e-11 (${DOC_JUDGES})`,
                  );
            },
          ),
        );
      }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// weights-wilson

const ULP_ONE = 2 ** -52;

/** 1 - lower bound of the Wilson interval, in a form with no difference of nearly equal numbers. */
function oneMinusLower(k: number, n: number, z: number): number {
  const z2 = z * z;
  return (2 * (n - k) + z2 + z * Math.sqrt(z2 + (4 * k * (n - k)) / n)) / (2 * (n + z2));
}

function wilsonItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'weights-wilson';
  const cause =
    'wilson loses relative accuracy on the bound next to 1 (a difference of nearly equal numbers)';
  for (const gap of [0, 1, 3])
    for (const exponent of [3, 6, 9, 12])
      for (const z of [1, 1.959963984540054]) {
        const id = `near-one.${gap}.1e${exponent}.z${z === 1 ? '1' : '95'}`;
        out.push(
          item(
            id,
            family,
            (exponent >= 9 ? 4 : 2) as Tier,
            'packages/stats/src/intervals.ts',
            cause,
            ({ s, rng }) => {
              const n = 10 ** exponent + between(rng, 0, 999);
              const k = n - gap;
              const got = s.wilson(k, n, z);
              const want = oneMinusLower(k, n, z);
              const checks: string[] = [];
              // A binary64 next to 1 holds 1 - lower only to one unit in the last place of 1, so the bar is that
              // unit: the bound computed as 1 - (the cancellation-free distance to 1) meets it.
              const lower = 1 - want;
              if (!(Math.abs(got.lower - lower) <= ULP_ONE))
                checks.push(
                  `lower is ${got.lower}, which is not within ${ULP_ONE} (one unit in the last place of 1) of the cancellation-free value`,
                );
              if (gap === 0 && got.upper !== 1) checks.push(`upper is ${got.upper}, not exactly 1 for k = n`);
              return checks.length === 0
                ? ok()
                : fail(`wilson(${k}, ${n}, ${z}): ${checks.join('; ')} (${DOC_INTERVALS})`);
            },
          ),
        );
      }
  // The mirror: the upper bound of n - k next to 0 is one minus the lower bound of k next to 1.
  for (const exponent of [4, 8, 12])
    for (const gap of [0, 2]) {
      const id = `mirror.${gap}.1e${exponent}`;
      out.push(
        item(id, family, 3, 'packages/stats/src/intervals.ts', cause, ({ s, rng }) => {
          const n = 10 ** exponent + between(rng, 0, 999);
          const k = n - gap;
          const high = s.wilson(k, n);
          const low = s.wilson(n - k, n);
          const small = oneMinusLower(k, n, 1.959963984540054);
          return relNear(low.upper, small, 1e-11) && Math.abs(high.lower - (1 - small)) <= ULP_ONE
            ? ok()
            : fail(
                `wilson(${n - k}, ${n}).upper is ${low.upper} and wilson(${k}, ${n}).lower is ${high.lower}; they do not mirror each other to a relative 1e-11 and ${ULP_ONE} (${DOC_INTERVALS})`,
              );
        }),
      );
    }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// weights-mixture

type MixtureFn = (
  components: number[][],
  counts: number[],
  options?: { tolerance?: number; maxIterations?: number },
) => { weights: number[]; iterations: number; logLikelihood: number };

const MIXTURE_CAUSE = 'mixtureWeights is missing from @agent-nexus/driftbench-stats';

function mixtureOf(s: Parameters<BankItem['check']>[0]['s']): MixtureFn | undefined {
  return exported(s, 'mixtureWeights') as MixtureFn | undefined;
}

/** The expectation-maximisation fixed point from equal weights, in binary64 (the maximum-likelihood mix). */
function emReference(components: number[][], counts: number[]): { weights: number[]; logLikelihood: number } {
  const m = components.length;
  const N = counts.reduce((x, y) => x + y, 0);
  let w = new Array<number>(m).fill(1 / m);
  for (let step = 0; step < 2_000_000; step += 1) {
    const next = new Array<number>(m).fill(0);
    counts.forEach((k, i) => {
      if (k === 0) return;
      const mixture = w.reduce((sum, wj, j) => sum + wj * ((components[j] as number[])[i] as number), 0);
      w.forEach((wj, j) => {
        next[j] = (next[j] as number) + (k * wj * ((components[j] as number[])[i] as number)) / mixture;
      });
    });
    const updated = next.map((v) => v / N);
    const moved = updated.reduce((x, v, j) => Math.max(x, Math.abs(v - (w[j] as number))), 0);
    w = updated;
    if (moved < 1e-15) break;
  }
  const logLikelihood = counts.reduce((sum, k, i) => {
    if (k === 0) return sum;
    return sum + k * Math.log(w.reduce((a, wj, j) => a + wj * ((components[j] as number[])[i] as number), 0));
  }, 0);
  return { weights: w, logLikelihood };
}

/** The result must be the maximum-likelihood mix: weights within 1e-6 and the log-likelihood within 1e-9 relative. */
function compareEm(mix: MixtureFn, components: number[][], counts: number[]): ItemOutcome {
  let got: ReturnType<MixtureFn>;
  try {
    got = mix(components, counts);
  } catch (cause) {
    return fail(
      `mixtureWeights threw ${String(cause)} on ${components.length} components over ${counts.length} categories`,
    );
  }
  const bad = weightsShape(got.weights, components.length);
  if (bad !== undefined) return fail(`mixtureWeights: ${bad} (${DOC_OWED})`);
  const want = emReference(components, counts);
  const off = want.weights.findIndex((w, j) => !(Math.abs((got.weights?.[j] ?? Number.NaN) - w) <= 1e-6));
  if (off >= 0)
    return fail(
      `mixtureWeights returned ${show(got.weights)} for ${counts.length} counts, which is not the maximum-likelihood mix (component ${off} is off by more than 1e-6) (${DOC_OWED})`,
    );
  return Math.abs(got.logLikelihood - want.logLikelihood) <= 1e-9 * Math.max(1, Math.abs(want.logLikelihood))
    ? ok()
    : fail(`mixtureWeights gives a logLikelihood that is not the maximum of the likelihood (${DOC_OWED})`);
}

function mixtureItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'weights-mixture';
  for (const m of [2, 3, 4, 5])
    for (const extra of [0, 1, 2])
      for (const size of ['small', 'large'] as const) {
        const id = `recover.${m}.${extra}.${size}`;
        out.push(
          item(
            id,
            family,
            (m >= 4 ? 4 : m === 3 ? 3 : 2) as Tier,
            'packages/stats/src/mixture.ts',
            MIXTURE_CAUSE,
            ({ s, rng }) => {
              const mix = mixtureOf(s);
              if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
              // Components as integer rows over a common denominator D, each heavy on its own category so the
              // rows are linearly independent; planted weights b_j / B; counts t * sum_j b_j a_ij, an exact mix.
              const c = m + extra;
              const D = 1000;
              const rows: number[][] = [];
              for (let j = 0; j < m; j += 1) {
                const row = Array.from({ length: c }, () => between(rng, 0, 40));
                row[j] = (row[j] as number) + 400;
                const total = row.reduce((x, y) => x + y, 0);
                const scaled = row.map((v) => Math.floor((v * D) / total));
                scaled[j] = (scaled[j] as number) + D - scaled.reduce((x, y) => x + y, 0);
                rows.push(scaled);
              }
              const b = Array.from({ length: m }, () => between(rng, 1, 9));
              const B = b.reduce((x, y) => x + y, 0);
              const t = size === 'small' ? 1 : between(rng, 50, 500);
              const counts = Array.from(
                { length: c },
                (_, i) => rows.reduce((sum, row, j) => sum + (b[j] as number) * (row[i] as number), 0) * t,
              );
              const components = rows.map((row) => row.map((v) => v / D));
              let got: ReturnType<MixtureFn>;
              try {
                got = mix(components, counts);
              } catch (cause) {
                return fail(`mixtureWeights threw ${String(cause)} on ${m} components over ${c} categories`);
              }
              const shape = weightsShape(got.weights, m);
              if (shape !== undefined) return fail(`mixtureWeights: ${shape} (${DOC_OWED})`);
              const want = b.map((v) => v / B);
              const off = want.findIndex((w, j) => !(Math.abs((got.weights?.[j] ?? Number.NaN) - w) <= 1e-7));
              if (off >= 0)
                return fail(
                  `mixtureWeights recovered ${show(got.weights)}; component ${off} is off the planted mix by more than 1e-7 (${DOC_OWED})`,
                );
              // The log-likelihood at the planted mix, sum_i counts_i log(share_i).
              const N = counts.reduce((x, y) => x + y, 0);
              const ll = counts.reduce((sum, k) => (k === 0 ? sum : sum + k * Math.log(k / N)), 0);
              return Math.abs(got.logLikelihood - ll) <= 1e-6 * Math.max(1, Math.abs(ll))
                ? ok()
                : fail(
                    `mixtureWeights gives logLikelihood ${got.logLikelihood}, which is off the log-likelihood at the planted mix by more than a relative 1e-6 (${DOC_OWED})`,
                  );
            },
          ),
        );
      }
  // Counts that are not an exact mix: any consistent estimator passes the items above, only the maximum
  // likelihood answer passes these. The reference is expectation-maximisation in binary64 run to a fixed point.
  const emCases: Array<{ id: string; m: number; extra: number; size: 'small' | 'large' }> = [];
  for (const m of [2, 3, 4])
    for (const extra of [1, 2])
      for (const size of ['small', 'large'] as const)
        emCases.push({ id: `${m}.${extra}.${size}`, m, extra, size });
  for (const spec of emCases) {
    out.push(
      item(
        `em.${spec.id}`,
        family,
        (spec.m >= 4 ? 4 : 3) as Tier,
        'packages/stats/src/mixture.ts',
        MIXTURE_CAUSE,
        ({ s, rng }) => {
          const mix = mixtureOf(s);
          if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
          const c = spec.m + spec.extra;
          const components = Array.from({ length: spec.m }, (_, j) => {
            const row = Array.from({ length: c }, () => 1 + rng() * 6);
            row[j] = (row[j] as number) + 14;
            const total = row.reduce((x, y) => x + y, 0);
            return row.map((v) => v / total);
          });
          const planted = Array.from({ length: spec.m }, () => 1 + rng() * 8);
          const pt = planted.reduce((x, y) => x + y, 0);
          const draws = spec.size === 'small' ? between(rng, 30, 80) : between(rng, 600, 2000);
          const counts = new Array<number>(c).fill(0);
          for (let d = 0; d < draws; d += 1) {
            let u = rng() * pt;
            let j = 0;
            while (j < spec.m - 1 && u >= (planted[j] as number)) {
              u -= planted[j] as number;
              j += 1;
            }
            let v = rng();
            let i = 0;
            while (i < c - 1 && v >= ((components[j] as number[])[i] as number)) {
              v -= (components[j] as number[])[i] as number;
              i += 1;
            }
            counts[i] = (counts[i] as number) + 1;
          }
          return compareEm(mix, components, counts);
        },
      ),
    );
  }
  out.push(
    item('em.audit-mix', family, 2, 'packages/stats/src/mixture.ts', MIXTURE_CAUSE, ({ s }) => {
      const mix = mixtureOf(s);
      if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
      return compareEm(
        mix,
        [
          [0.7, 0.2, 0.1],
          [0.1, 0.3, 0.6],
        ],
        [50, 25, 25],
      );
    }),
    item('em.boundary', family, 2, 'packages/stats/src/mixture.ts', MIXTURE_CAUSE, ({ s }) => {
      const mix = mixtureOf(s);
      if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
      return compareEm(
        mix,
        [
          [0.9, 0.1],
          [0.2, 0.8],
        ],
        [97, 3],
      );
    }),
  );
  const refusals: Array<[string, string, (rng: () => number) => [number[][], number[]]]> = [
    ['no-component', 'components', () => [[], [1, 2]]],
    ['length-mismatch', 'components', () => [[[0.5, 0.5]], [1, 2, 3]]],
    ['row-not-one', 'components', () => [[[0.5, 0.4]], [1, 2]]],
    ['entry-outside', 'components', () => [[[1.5, -0.5]], [1, 2]]],
    ['fractional-count', 'counts', () => [[[0.5, 0.5]], [1.5, 2]]],
    ['all-zero', 'counts', () => [[[0.5, 0.5]], [0, 0]]],
  ];
  for (const [what, argument, make] of refusals) {
    out.push(
      item(`refuse.${what}`, family, 1, 'packages/stats/src/mixture.ts', MIXTURE_CAUSE, ({ s, rng }) => {
        const mix = mixtureOf(s);
        if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
        const [components, counts] = make(rng);
        try {
          const value = mix(components, counts);
          return fail(
            `mixtureWeights(${show(components)}, ${show(counts)}) returned ${show(value)}, want a RangeError`,
          );
        } catch (cause) {
          if (!(cause instanceof RangeError))
            return fail(`mixtureWeights threw ${String(cause)}, want a RangeError (${DOC_OWED})`);
          return messageNames(cause.message, 'mixtureWeights', argument);
        }
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// weights-coverage

type Group = { axes: number[]; strength: number };
type CoverageFn = (
  rows: number[][],
  groups: Group[],
  levels: number[],
) => {
  groups: Array<{ covered: number; required: number; coverage: number }>;
  covered: number;
  required: number;
  coverage: number;
};
const COVERAGE_CAUSE = 'mixedStrengthCoverage is missing from @agent-nexus/driftbench-stats';

function subsets(items: number[], size: number): number[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items as [number, ...number[]];
  return [...subsets(rest, size - 1).map((s) => [head, ...s]), ...subsets(rest, size)];
}

/** Brute force: every required tuple of every group, and whether a row holds it. */
function coverageRef(rows: number[][], groups: Group[], levels: number[]) {
  const per = groups.map((group) => {
    let required = 0;
    let covered = 0;
    for (const axes of subsets(
      [...group.axes].sort((a, b) => a - b),
      group.strength,
    )) {
      const combos = axes.reduce((x, a) => x * (levels[a] as number), 1);
      required += combos;
      const seen = new Set(rows.map((row) => axes.map((a) => row[a]).join(',')));
      covered += seen.size;
    }
    return { covered, required, coverage: covered / required };
  });
  const covered = per.reduce((x, g) => x + g.covered, 0);
  const required = per.reduce((x, g) => x + g.required, 0);
  return { groups: per, covered, required, coverage: covered / required };
}

function coverageItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'weights-coverage';
  const shapes = ['one-pairwise', 'one-triple', 'mixed', 'overlapping'] as const;
  for (const shape of shapes)
    for (const axesCount of [4, 6, 8])
      for (const size of ['sparse', 'dense'] as const) {
        const id = `mixed-strength.${shape}.${axesCount}.${size}`;
        out.push(
          item(
            id,
            family,
            (shape === 'overlapping' ? 4 : shape === 'mixed' ? 3 : 2) as Tier,
            'packages/stats/src/coverage.ts',
            COVERAGE_CAUSE,
            ({ s, rng }) => {
              const fn = exported(s, 'mixedStrengthCoverage') as CoverageFn | undefined;
              if (!fn) return fail(`mixedStrengthCoverage is not exported (${DOC_OWED})`);
              const levels = Array.from({ length: axesCount }, () => between(rng, 2, 4));
              const all = Array.from({ length: axesCount }, (_, a) => a);
              const half = Math.floor(axesCount / 2);
              const groups: Group[] =
                shape === 'one-pairwise'
                  ? [{ axes: all, strength: 2 }]
                  : shape === 'one-triple'
                    ? [{ axes: all.slice(0, Math.min(5, axesCount)), strength: 3 }]
                    : shape === 'mixed'
                      ? [
                          { axes: all, strength: 2 },
                          { axes: all.slice(0, Math.min(4, axesCount)), strength: 3 },
                        ]
                      : [
                          { axes: all.slice(0, half + 1), strength: 2 },
                          { axes: all.slice(half - 1), strength: 3 },
                        ];
              const count = size === 'sparse' ? between(rng, 4, 10) : between(rng, 30, 80);
              const rows = Array.from({ length: count }, () => levels.map((l) => between(rng, 0, l - 1)));
              if (size === 'dense') {
                // Many rows cover nearly every tuple, so a stub that returns full coverage would pass. One tuple of
                // the first group is left uncovered on purpose: every row that holds it is moved off it.
                const first = groups[0] as Group;
                const axes = [...first.axes].sort((a, b) => a - b).slice(0, first.strength);
                const tuple = axes.map((a) => between(rng, 0, (levels[a] as number) - 1));
                const last = axes[axes.length - 1] as number;
                for (const row of rows)
                  if (axes.every((a, i) => row[a] === tuple[i]))
                    row[last] = ((row[last] as number) + 1) % (levels[last] as number);
              }
              const want = coverageRef(rows, groups, levels);
              let got: ReturnType<CoverageFn>;
              try {
                got = fn(rows, groups, levels);
              } catch (cause) {
                return fail(`mixedStrengthCoverage threw ${String(cause)}`);
              }
              const bad: string[] = [];
              want.groups.forEach((g, i) => {
                const h = got.groups?.[i];
                if (
                  !h ||
                  h.covered !== g.covered ||
                  h.required !== g.required ||
                  !(Math.abs(h.coverage - g.coverage) <= 1e-15)
                )
                  bad.push(`group ${i}: got ${show(h)}, which differs from the brute-force count`);
              });
              if (got.covered !== want.covered || got.required !== want.required)
                bad.push(`totals ${got.covered} of ${got.required} differ from the brute-force count`);
              return bad.length === 0 ? ok() : fail(`mixedStrengthCoverage: ${bad.join('; ')} (${DOC_OWED})`);
            },
          ),
        );
      }
  const refusals: Array<[string, string, [number[][], Group[], number[]]]> = [
    ['no-group', 'groups', [[[0, 1]], [], [2, 2]]],
    ['row-length', 'rows', [[[0, 1, 0]], [{ axes: [0, 1], strength: 2 }], [2, 2]]],
    ['value-outside', 'rows', [[[0, 2]], [{ axes: [0, 1], strength: 2 }], [2, 2]]],
    ['axis-repeated', 'groups', [[[0, 1]], [{ axes: [0, 0], strength: 2 }], [2, 2]]],
    ['strength-above', 'groups', [[[0, 1]], [{ axes: [0, 1], strength: 3 }], [2, 2]]],
    ['level-zero', 'levels', [[[0, 0]], [{ axes: [0, 1], strength: 1 }], [2, 0]]],
    ['level-zero-no-rows', 'levels', [[], [{ axes: [0, 1], strength: 1 }], [2, 0]]],
    ['level-fractional', 'levels', [[], [{ axes: [0, 1], strength: 1 }], [2, 1.5]]],
  ];
  for (const [what, argument, args] of refusals) {
    out.push(
      item(
        `refuse.${what}`,
        family,
        1,
        'packages/stats/src/coverage.ts',
        COVERAGE_CAUSE,
        ({ s }): ItemOutcome => {
          const fn = exported(s, 'mixedStrengthCoverage') as CoverageFn | undefined;
          if (!fn) return fail(`mixedStrengthCoverage is not exported (${DOC_OWED})`);
          try {
            const value = fn(...args);
            return fail(`mixedStrengthCoverage(${show(args)}) returned ${show(value)}, want a RangeError`);
          } catch (cause) {
            if (!(cause instanceof RangeError))
              return fail(`mixedStrengthCoverage threw ${String(cause)}, want a RangeError (${DOC_OWED})`);
            return messageNames(cause.message, 'mixedStrengthCoverage', argument);
          }
        },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Closure items: behaviour a page states, found missing by the planted-bug round of the audit.

const CLOSURE_AGREEMENT_CAUSE =
  'krippendorffAlpha or cohenKappa departs from the page on a case the first items did not reach (levels, undefined and ragged data, constant data, default order)';

function closureItems(): BankItem[] {
  const out: BankItem[] = [];
  const family = 'weights-agreement';
  const agreement = 'packages/stats/src/agreement.ts';
  const kappaOf = (s: Parameters<BankItem['check']>[0]['s'], a: unknown[], b: unknown[], options: unknown) =>
    (s.cohenKappa as unknown as (a: unknown[], b: unknown[], o: unknown) => { kappa: number })(a, b, options)
      .kappa;

  // Weighted kappa when both raters are constant: the chance term is 0 and kappa is 1.
  for (const weights of ['linear', 'quadratic'] as const)
    out.push(
      item(`kappa.constant.${weights}`, family, 2, agreement, CLOSURE_AGREEMENT_CAUSE, ({ s, rng }) => {
        const label = between(rng, 1, 9);
        const n = between(rng, 2, 6);
        const a = Array.from({ length: n }, () => label);
        try {
          const got = kappaOf(s, a, [...a], { weights });
          return got === 1
            ? ok()
            : fail(
                `cohenKappa of two constant raters (n ${n}, weights ${weights}) is ${got}, not 1 (${DOC_JUDGES})`,
              );
        } catch (cause) {
          return fail(`cohenKappa of two constant raters threw ${String(cause)}`);
        }
      }),
    );
  // The default order of number labels is numeric, not string order (1, 2, 10 and not 1, 10, 2).
  for (const weights of ['linear', 'quadratic'] as const)
    for (const variant of [0, 1]) {
      out.push(
        item(
          `kappa.default-order.numbers.${weights}.${variant}`,
          family,
          3,
          agreement,
          CLOSURE_AGREEMENT_CAUSE,
          ({ s, rng }) => {
            const labels = variant === 0 ? [1, 2, 10] : [3, 12, 100, 21, 5];
            const n = between(rng, 24, 60);
            const a = Array.from({ length: n }, () => labels[between(rng, 0, labels.length - 1)] as number);
            const b = a.map((x) =>
              rng() < 0.6 ? x : (labels[between(rng, 0, labels.length - 1)] as number),
            );
            const order = [...new Set([...a, ...b])].sort((x, y) => x - y);
            const want = toNumber(kappaRef(a, b, order, weights));
            try {
              const got = kappaOf(s, a, b, { weights });
              return relNear(got, want, 1e-11)
                ? ok()
                : fail(
                    `cohenKappa with number labels and no categories (weights ${weights}): got ${got}, which is not the value over the numeric order (${DOC_JUDGES})`,
                  );
            } catch (cause) {
              return fail(`cohenKappa with number labels threw ${String(cause)}`);
            }
          },
        ),
      );
    }
  // Mixed number and string labels have no numeric order: the default is the string order of the labels.
  for (const weights of ['linear', 'quadratic'] as const)
    out.push(
      item(
        `kappa.default-order.mixed.${weights}`,
        family,
        3,
        agreement,
        CLOSURE_AGREEMENT_CAUSE,
        ({ s, rng }) => {
          const labels: Array<number | string> = [12, 3, 'b', 'a'];
          const n = between(rng, 24, 60);
          const a = Array.from(
            { length: n },
            () => labels[between(rng, 0, labels.length - 1)] as number | string,
          );
          const b = a.map((x) =>
            rng() < 0.6 ? x : (labels[between(rng, 0, labels.length - 1)] as number | string),
          );
          const order = [...new Set([...a, ...b])].sort((x, y) => String(x).localeCompare(String(y)));
          const index = new Map(order.map((l, i) => [l, i]));
          const want = toNumber(
            kappaRef(
              a.map((l) => index.get(l) as number),
              b.map((l) => index.get(l) as number),
              order.map((_, i) => i),
              weights,
            ),
          );
          try {
            const got = kappaOf(s, a, b, { weights });
            return relNear(got, want, 1e-11)
              ? ok()
              : fail(
                  `cohenKappa with mixed labels and no categories (weights ${weights}): got ${got}, which is not the value over the string order (${DOC_JUDGES})`,
                );
          } catch (cause) {
            return fail(`cohenKappa with mixed labels threw ${String(cause)}`);
          }
        },
      ),
    );

  const alphaOf = (s: Parameters<BankItem['check']>[0]['s'], matrix: unknown, level: AlphaLevel) =>
    (s.krippendorffAlpha as unknown as (m: unknown, o: unknown) => { alpha: number })(matrix, { level })
      .alpha;
  const alphaMatrix = (
    rng: () => number,
    raters: number,
    gaps: 'null' | 'undefined' | 'none',
    positiveOnly = true,
  ) => {
    const units = between(rng, 10, 30);
    const values = between(rng, 3, 6);
    const matrix: Array<Array<number | null | undefined>> = Array.from({ length: raters }, () => []);
    for (let u = 0; u < units; u += 1) {
      const truth = between(rng, positiveOnly ? 1 : 0, values);
      for (let r = 0; r < raters; r += 1) {
        const gone = gaps !== 'none' && rng() < 0.3;
        const v = rng() < 0.65 ? truth : between(rng, positiveOnly ? 1 : 0, values);
        (matrix[r] as Array<number | null | undefined>).push(gone ? (gaps === 'null' ? null : undefined) : v);
      }
    }
    return matrix;
  };
  const compareAlpha = (
    s: Parameters<BankItem['check']>[0]['s'],
    given: unknown,
    reference: Array<Array<number | null | undefined>>,
    level: AlphaLevel,
    what: string,
  ): ItemOutcome => {
    const want = alphaRef(reference, level);
    if (want === undefined) return ok('no expected disagreement on this draw');
    try {
      const got = alphaOf(s, given, level);
      return relNear(got, toNumber(want), 1e-11)
        ? ok()
        : fail(
            `krippendorffAlpha (${what}, level ${level}): got ${got}, which differs from the reference by more than a relative 1e-11 (${DOC_JUDGES})`,
          );
    } catch (cause) {
      return fail(`krippendorffAlpha (${what}, level ${level}) threw ${String(cause)}`);
    }
  };
  // The ordinal and ratio levels.
  for (const level of ['ordinal', 'ratio'] as const)
    for (const raters of [2, 3])
      out.push(
        item(`alpha.${level}.${raters}`, family, 3, agreement, CLOSURE_AGREEMENT_CAUSE, ({ s, rng }) => {
          const matrix = alphaMatrix(rng, raters, 'null');
          return compareAlpha(s, matrix, matrix, level, `${raters} raters`);
        }),
      );
  // undefined marks a missing value as null does.
  for (const level of ['nominal', 'interval'] as const)
    out.push(
      item(`alpha.undefined-holes.${level}`, family, 3, agreement, CLOSURE_AGREEMENT_CAUSE, ({ s, rng }) => {
        const matrix = alphaMatrix(rng, 3, 'undefined');
        return compareAlpha(s, matrix, matrix, level, 'undefined holes');
      }),
    );
  // Rows of different lengths: a row that stops early has missing values for the later units.
  for (const level of ['nominal', 'interval'] as const)
    out.push(
      item(`alpha.ragged.${level}`, family, 3, agreement, CLOSURE_AGREEMENT_CAUSE, ({ s, rng }) => {
        const matrix = alphaMatrix(rng, 3, 'none');
        // The first rows stop early; the last row is the longest, so the units are not those of the first row.
        const ragged = matrix.map((row, r) =>
          row.slice(0, row.length - (r === matrix.length - 1 ? 0 : between(rng, 1, 4))),
        );
        return compareAlpha(s, ragged, ragged, level, 'rows of different lengths');
      }),
    );
  // Constant data: the chance disagreement is 0 and alpha is 1.
  out.push(
    item('alpha.constant', family, 2, agreement, CLOSURE_AGREEMENT_CAUSE, ({ s, rng }) => {
      const v = between(rng, 1, 9);
      const matrix = [
        [v, v, v],
        [v, v, v],
      ];
      for (const level of ['nominal', 'interval', 'ordinal', 'ratio'] as const) {
        try {
          const got = alphaOf(s, matrix, level);
          if (got !== 1)
            return fail(
              `krippendorffAlpha of constant data at level ${level} is ${got}, not 1 (${DOC_JUDGES})`,
            );
        } catch (cause) {
          return fail(`krippendorffAlpha of constant data at level ${level} threw ${String(cause)}`);
        }
      }
      return ok();
    }),
  );

  // Wilson at k = 0: the lower bound is exactly 0 for every n, the large ones included.
  out.push(
    item(
      'wilson.k0-lower',
      'weights-wilson',
      3,
      'packages/stats/src/intervals.ts',
      'wilson does not return a lower bound of exactly 0 at k = 0',
      ({ s, rng }) => {
        for (const exponent of [0, 2, 6, 9, 12]) {
          const n = 10 ** exponent + between(rng, 0, 99);
          for (const z of [1, 1.959963984540054, 3]) {
            const got = s.wilson(0, n, z);
            if (got.lower !== 0)
              return fail(`wilson(0, ${n}, ${z}).lower is ${got.lower}, not exactly 0 (${DOC_INTERVALS})`);
          }
        }
        return ok();
      },
    ),
  );
  // Wilson z: a z that is not above 0, or not finite, is refused with a message that names z.
  for (const [what, z] of [
    ['zero', 0],
    ['negative', -1.96],
    ['nan', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ] as const)
    out.push(
      item(
        `wilson.refuse.z-${what}`,
        'weights-wilson',
        1,
        'packages/stats/src/intervals.ts',
        'wilson accepts a z that is not above 0',
        ({ s }) => {
          try {
            const got = s.wilson(3, 10, z);
            return fail(`wilson(3, 10, ${z}) returned ${show(got)}, want a RangeError (${DOC_INTERVALS})`);
          } catch (cause) {
            if (!(cause instanceof RangeError))
              return fail(`wilson threw ${String(cause)}, want a RangeError`);
            return messageNames(cause.message, 'wilson', 'z');
          }
        },
      ),
    );

  // Two raters who give one identical label on every item agree perfectly: kappa is 1, unweighted or weighted.
  for (const [what, labels] of [
    ['string', ['a']],
    ['number', [7]],
    ['boolean', [true]],
  ] as const)
    out.push(
      item(
        `kappa.constant-identical.${what}`,
        family,
        2,
        agreement,
        CLOSURE_AGREEMENT_CAUSE,
        ({ s, rng }) => {
          const n = between(rng, 1, 6);
          const a = Array.from({ length: n }, () => labels[0]);
          for (const weights of [undefined, 'none', 'linear', 'quadratic'] as const) {
            try {
              const got = kappaOf(s, a, [...a], weights === undefined ? {} : { weights });
              if (got !== 1)
                return fail(
                  `cohenKappa of two raters giving one identical ${what} label on ${n} items (weights ${weights ?? 'unset'}) is ${got}, not 1 (${DOC_JUDGES})`,
                );
            } catch (cause) {
              return fail(`cohenKappa of two identical constant raters threw ${String(cause)}`);
            }
          }
          return ok();
        },
      ),
    );
  // A group's axis must be an integer inside 0 to levels.length - 1: the bound itself, below 0 and a fraction are refused.
  for (const [what, axes] of [
    ['axis-equal-levels', [0, 2]],
    ['axis-negative', [0, -1]],
    ['axis-fraction', [0, 0.5]],
  ] as const)
    out.push(
      item(
        `mixed-strength.refuse.${what}`,
        'weights-coverage',
        1,
        'packages/stats/src/coverage.ts',
        COVERAGE_CAUSE,
        ({ s }) => {
          const fn = exported(s, 'mixedStrengthCoverage') as CoverageFn | undefined;
          if (!fn) return fail(`mixedStrengthCoverage is not exported (${DOC_OWED})`);
          const args: [number[][], Group[], number[]] = [
            [[0, 1]],
            [{ axes: [...axes], strength: 1 }],
            [2, 2],
          ];
          try {
            const value = fn(...args);
            return fail(`mixedStrengthCoverage(${show(args)}) returned ${show(value)}, want a RangeError`);
          } catch (cause) {
            if (!(cause instanceof RangeError))
              return fail(`mixedStrengthCoverage threw ${String(cause)}, want a RangeError (${DOC_OWED})`);
            return messageNames(cause.message, 'mixedStrengthCoverage', 'groups');
          }
        },
      ),
    );

  // Mixture: the row sum tolerance is 1e-12, and categories no component reaches give no NaN.
  for (const [what, row] of [
    ['above', [0.5005, 0.5]],
    ['below', [0.4999999, 0.5]],
    ['tiny', [0.5 + 1e-9, 0.5]],
  ] as const)
    out.push(
      item(
        `mixture.refuse.sum-${what}`,
        'weights-mixture',
        1,
        'packages/stats/src/mixture.ts',
        MIXTURE_CAUSE,
        ({ s }) => {
          const mix = mixtureOf(s);
          if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
          try {
            const value = mix([[...row]], [3, 2]);
            return fail(
              `mixtureWeights with a component summing to ${(row[0] ?? 0) + (row[1] ?? 0)} returned ${show(value)}, want a RangeError (${DOC_OWED})`,
            );
          } catch (cause) {
            if (!(cause instanceof RangeError))
              return fail(`mixtureWeights threw ${String(cause)}, want a RangeError`);
            return messageNames(cause.message, 'mixtureWeights', 'components');
          }
        },
      ),
    );
  out.push(
    item(
      'mixture.unreachable-count',
      'weights-mixture',
      2,
      'packages/stats/src/mixture.ts',
      MIXTURE_CAUSE,
      ({ s }) => {
        const mix = mixtureOf(s);
        if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
        // A count in a category no component can produce: the likelihood is 0 for every mix. A RangeError is right;
        // so is a finite mix over the reachable categories. NaN is not.
        try {
          const got = mix(
            [
              [1, 0],
              [1, 0],
            ],
            [3, 2],
          );
          const sum = (got.weights ?? []).reduce((x, y) => x + y, 0);
          return got.weights?.length === 2 &&
            got.weights.every((w) => Number.isFinite(w) && w >= 0) &&
            Math.abs(sum - 1) <= 1e-9
            ? ok()
            : fail(
                `mixtureWeights with a count in a category no component reaches returned weights ${show(got.weights)}; want a RangeError or finite weights summing to 1 (${DOC_OWED})`,
              );
        } catch (cause) {
          return cause instanceof RangeError
            ? messageNames(cause.message, 'mixtureWeights', 'counts')
            : fail(`mixtureWeights threw ${String(cause)}`);
        }
      },
    ),
    item(
      'mixture.unreachable-empty',
      'weights-mixture',
      2,
      'packages/stats/src/mixture.ts',
      MIXTURE_CAUSE,
      ({ s }) => {
        const mix = mixtureOf(s);
        if (!mix) return fail(`mixtureWeights is not exported (${DOC_OWED})`);
        // A category with count 0 that no component reaches takes no part: the mix is the one over the others.
        return compareEm(
          mix,
          [
            [0.6, 0.4, 0],
            [0.1, 0.9, 0],
          ],
          [30, 70, 0],
        );
      },
    ),
  );

  // Coverage: a tuple key must not collide when levels reach 10, and the total coverage is covered over required.
  for (const variant of [0, 1, 2])
    out.push(
      item(
        `mixed-strength.wide-levels.${variant}`,
        'weights-coverage',
        3,
        'packages/stats/src/coverage.ts',
        COVERAGE_CAUSE,
        ({ s, rng }) => {
          const fn = exported(s, 'mixedStrengthCoverage') as CoverageFn | undefined;
          if (!fn) return fail(`mixedStrengthCoverage is not exported (${DOC_OWED})`);
          const axesCount = 3 + variant;
          const levels = Array.from({ length: axesCount }, () => between(rng, 12, 15));
          const rows = Array.from({ length: between(rng, 20, 60) }, () =>
            levels.map((l) => between(rng, 0, l - 1)),
          );
          // Rows that would collide under a key joined without a separator: [1, 11] and [11, 1].
          rows.push(
            levels.map((_, a) => (a === 0 ? 1 : a === 1 ? 11 : 0)),
            levels.map((_, a) => (a === 0 ? 11 : a === 1 ? 1 : 0)),
          );
          const groups: Group[] = [{ axes: Array.from({ length: axesCount }, (_, a) => a), strength: 2 }];
          const want = coverageRef(rows, groups, levels);
          let got: ReturnType<CoverageFn>;
          try {
            got = fn(rows, groups, levels);
          } catch (cause) {
            return fail(`mixedStrengthCoverage threw ${String(cause)}`);
          }
          return got.covered === want.covered && got.required === want.required
            ? ok()
            : fail(
                `mixedStrengthCoverage with levels above 9: ${got.covered} of ${got.required} differ from the brute-force count (${DOC_OWED})`,
              );
        },
      ),
    );
  for (const variant of [0, 1, 2])
    out.push(
      item(
        `mixed-strength.total-ratio.${variant}`,
        'weights-coverage',
        3,
        'packages/stats/src/coverage.ts',
        COVERAGE_CAUSE,
        ({ s, rng }) => {
          const fn = exported(s, 'mixedStrengthCoverage') as CoverageFn | undefined;
          if (!fn) return fail(`mixedStrengthCoverage is not exported (${DOC_OWED})`);
          const levels = [between(rng, 2, 4), between(rng, 2, 4), between(rng, 2, 4), between(rng, 2, 3)];
          const rows = Array.from({ length: between(rng, 3, 8) }, () =>
            levels.map((l) => between(rng, 0, l - 1)),
          );
          // A pair group and a triple group have different required counts, so the mean of the two ratios is not the total ratio.
          const groups: Group[] = [
            { axes: [0, 1], strength: 2 },
            { axes: [0, 1, 2, 3], strength: 3 },
          ];
          const want = coverageRef(rows, groups, levels);
          let got: ReturnType<CoverageFn>;
          try {
            got = fn(rows, groups, levels);
          } catch (cause) {
            return fail(`mixedStrengthCoverage threw ${String(cause)}`);
          }
          return Math.abs(got.coverage - want.coverage) <= 1e-15
            ? ok()
            : fail(
                `mixedStrengthCoverage total coverage is ${got.coverage}, which is not the covered over the required tuples of all groups (${DOC_OWED})`,
              );
        },
      ),
    );
  return out;
}

/** Every item of the weights lane. */
export function weightsItems(): BankItem[] {
  return [...agreementItems(), ...wilsonItems(), ...mixtureItems(), ...coverageItems(), ...closureItems()];
}
