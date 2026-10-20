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
 * All four are the last level, `capabilities`, so a missing capability never hides a regression below.
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
 * non-negative integer, and counts that are all 0.
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
 * above the group's axis count.
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
  return { id: `weights.${id}`, family, tier, level: 'capabilities', component, cause, check };
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

/** Exact Krippendorff's alpha from its definition over pairable values (integer values). */
function alphaRef(matrix: Array<Array<number | null>>, level: 'nominal' | 'interval'): Q | undefined {
  const units = matrix[0]?.length ?? 0;
  const delta = (x: number, y: number): bigint =>
    x === y ? 0n : level === 'nominal' ? 1n : BigInt((x - y) * (x - y));
  let disagreement = q(0n);
  const pool: number[] = [];
  for (let u = 0; u < units; u += 1) {
    const vals = matrix.map((row) => row[u]).filter((v): v is number => v !== null && v !== undefined);
    if (vals.length < 2) continue;
    pool.push(...vals);
    let s = 0n;
    for (let i = 0; i < vals.length; i += 1)
      for (let j = 0; j < vals.length; j += 1) if (i !== j) s += delta(vals[i] as number, vals[j] as number);
    disagreement = add(disagreement, q(s, BigInt(vals.length - 1)));
  }
  const n = BigInt(pool.length);
  let chance = 0n;
  for (let i = 0; i < pool.length; i += 1)
    for (let j = 0; j < pool.length; j += 1)
      if (i !== j) chance += delta(pool[i] as number, pool[j] as number);
  if (chance === 0n) return undefined;
  return sub(q(1n), div(mul(q(n - 1n), disagreement), q(chance)));
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
                    `cohenKappa over ${n} items, ${k} categories (${shape}), weights ${weights}: got ${got}, want ${want} (${DOC_JUDGES})`,
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
              const matrix: Array<Array<number | null>> = Array.from({ length: raters }, () => []);
              for (let u = 0; u < units; u += 1) {
                const truth = between(rng, 1, values);
                for (let r = 0; r < raters; r += 1) {
                  const gone = missing === 'some' && rng() < 0.3;
                  const v = rng() < 0.7 ? truth : between(rng, 1, values);
                  (matrix[r] as Array<number | null>).push(gone ? null : v);
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
                    `krippendorffAlpha over ${raters} raters and ${units} units (${missing} missing), level ${level}: got ${got}, want ${toNumber(want)} (${DOC_JUDGES})`,
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
                  `lower is ${got.lower}, want ${lower} within ${ULP_ONE} (one unit in the last place of 1)`,
                );
              if (gap === 0 && got.upper !== 1)
                checks.push(`upper is ${got.upper}, want exactly 1 for k = n`);
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
                `wilson(${n - k}, ${n}).upper is ${low.upper}, want ${small} within a relative 1e-11; wilson(${k}, ${n}).lower is ${high.lower}, want ${1 - small} within ${ULP_ONE} (${DOC_INTERVALS})`,
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
              const want = b.map((v) => v / B);
              const off = want.findIndex((w, j) => !(Math.abs((got.weights?.[j] ?? Number.NaN) - w) <= 1e-7));
              if (off >= 0)
                return fail(
                  `mixtureWeights recovered ${show(got.weights)}, the planted mix is ${show(want)} (component ${off}) (${DOC_OWED})`,
                );
              // The log-likelihood at the planted mix, sum_i counts_i log(share_i).
              const N = counts.reduce((x, y) => x + y, 0);
              const ll = counts.reduce((sum, k) => (k === 0 ? sum : sum + k * Math.log(k / N)), 0);
              return Math.abs(got.logLikelihood - ll) <= 1e-6 * Math.max(1, Math.abs(ll))
                ? ok()
                : fail(`mixtureWeights gives logLikelihood ${got.logLikelihood}, want ${ll} (${DOC_OWED})`);
            },
          ),
        );
      }
  const refusals: Array<[string, (rng: () => number) => [number[][], number[]]]> = [
    ['no-component', () => [[], [1, 2]]],
    ['length-mismatch', () => [[[0.5, 0.5]], [1, 2, 3]]],
    ['row-not-one', () => [[[0.5, 0.4]], [1, 2]]],
    ['entry-outside', () => [[[1.5, -0.5]], [1, 2]]],
    ['fractional-count', () => [[[0.5, 0.5]], [1.5, 2]]],
    ['all-zero', () => [[[0.5, 0.5]], [0, 0]]],
  ];
  for (const [what, make] of refusals) {
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
          return cause instanceof RangeError
            ? ok()
            : fail(`mixtureWeights threw ${String(cause)}, want a RangeError (${DOC_OWED})`);
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
                  bad.push(`group ${i}: got ${show(h)}, want ${show(g)}`);
              });
              if (got.covered !== want.covered || got.required !== want.required)
                bad.push(
                  `totals ${got.covered} of ${got.required}, want ${want.covered} of ${want.required}`,
                );
              return bad.length === 0 ? ok() : fail(`mixedStrengthCoverage: ${bad.join('; ')} (${DOC_OWED})`);
            },
          ),
        );
      }
  const refusals: Array<[string, [number[][], Group[], number[]]]> = [
    ['no-group', [[[0, 1]], [], [2, 2]]],
    ['row-length', [[[0, 1, 0]], [{ axes: [0, 1], strength: 2 }], [2, 2]]],
    ['value-outside', [[[0, 2]], [{ axes: [0, 1], strength: 2 }], [2, 2]]],
    ['axis-repeated', [[[0, 1]], [{ axes: [0, 0], strength: 2 }], [2, 2]]],
    ['strength-above', [[[0, 1]], [{ axes: [0, 1], strength: 3 }], [2, 2]]],
    ['level-zero', [[[0, 0]], [{ axes: [0, 1], strength: 1 }], [2, 0]]],
  ];
  for (const [what, args] of refusals) {
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
            return cause instanceof RangeError
              ? ok()
              : fail(`mixedStrengthCoverage threw ${String(cause)}, want a RangeError (${DOC_OWED})`);
          }
        },
      ),
    );
  }
  return out;
}

/** Every item of the weights lane. */
export function weightsItems(): BankItem[] {
  return [...agreementItems(), ...wilsonItems(), ...mixtureItems(), ...coverageItems()];
}
