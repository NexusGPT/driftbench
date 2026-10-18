import type { Observation } from '@agent-nexus/driftbench-stats';
import { normal } from '../draw';
import { REFERENCE_TOLERANCE, type StatsImpl } from '../reference';
import { attempt, type BankItem, fail, near, ok, show, type Tier } from './item';

/**
 * Level `analytic`: each estimator and test against a truth known by construction: an analytic value of a
 * constructed distribution, a brute-force enumeration over a small space, or a second implementation written
 * here from the textbook formula (docs/validators.md section 12.2, rules 2 and 6).
 */

const FILES = {
  basics: 'packages/stats/src/basics.ts',
  reliability: 'packages/stats/src/reliability.ts',
  intervals: 'packages/stats/src/intervals.ts',
  paired: 'packages/stats/src/paired.ts',
  drift: 'packages/stats/src/drift.ts',
  multiple: 'packages/stats/src/multiple.ts',
  agreement: 'packages/stats/src/agreement.ts',
  coverage: 'packages/stats/src/coverage.ts',
  variance: 'packages/stats/src/variance.ts',
} as const;

function item(
  id: string,
  family: string,
  tier: Tier,
  component: string,
  check: BankItem['check'],
  budgetMs?: number,
): BankItem {
  return { id, family, tier, level: 'analytic', component, check, ...(budgetMs ? { budgetMs } : {}) };
}

/** Runs a call and turns a throw into a failing outcome naming the call. */
function guarded<T>(call: string, f: () => T, then: (value: T) => ReturnType<BankItem['check']>) {
  const got = attempt(f);
  if (got.error) return fail(`${call} threw ${got.error.name}: ${got.error.message}`);
  return then(got.value as T);
}

// ---------------------------------------------------------------------------------------------------------
// Family estimators-distributions: mean, median, variance and the 10-90 spread on six constructed distributions.

type Dist = {
  key: string;
  label: string;
  draw(rng: () => number): number;
  mean: number;
  median: number;
  variance: number;
  spread: number;
  /** Tolerances: 6 standard errors at n = 20000, from the analytic moments and densities (0 = exact). */
  tol: { mean: number; median: number; variance: number; spread: number };
};

const N = 20000;
const se = (x: number) => (6 * x) / Math.sqrt(N);
const t5 = (rng: () => number) => {
  const z = normal(rng);
  let chi = 0;
  for (let i = 0; i < 5; i += 1) chi += normal(rng) ** 2;
  return z / Math.sqrt(chi / 5);
};
const poisson4 = (rng: () => number) => {
  const limit = Math.exp(-4);
  let k = 0;
  let p = rng();
  while (p > limit) {
    k += 1;
    p *= rng();
  }
  return k;
};

/** Truths computed with scipy (norm, t, brentq on the mixture cdf); recorded in the handover. */
const DISTS: Dist[] = [
  {
    key: 'normal',
    label: 'normal(mean 5, sd 2)',
    draw: (rng) => 5 + 2 * normal(rng),
    mean: 5,
    median: 5,
    variance: 4,
    spread: 2 * (7.563103131089201 - 5),
    tol: {
      mean: se(2),
      median: se(0.5 / 0.19947114020071635),
      variance: se(Math.sqrt(32)),
      spread: 2 * se(0.3 / 0.08774916596624342),
    },
  },
  {
    key: 'uniform',
    label: 'uniform(0, 1)',
    draw: (rng) => rng(),
    mean: 0.5,
    median: 0.5,
    variance: 1 / 12,
    spread: 0.8,
    tol: {
      mean: se(Math.sqrt(1 / 12)),
      median: se(0.5),
      variance: se(Math.sqrt(1 / 80 - 1 / 144)),
      spread: 2 * se(0.3),
    },
  },
  {
    key: 'bimodal',
    label: 'bimodal (half normal(-3, 1), half normal(3, 1))',
    draw: (rng) => (rng() < 0.5 ? -3 : 3) + normal(rng),
    mean: 0,
    median: 0,
    variance: 10,
    spread: 2 * 3.8416212335868813,
    tol: {
      mean: se(Math.sqrt(10)),
      median: se(0.5 / 0.0044318484119380075),
      variance: se(Math.sqrt(38)),
      spread: 2 * se(0.3 / 0.13998096021592654),
    },
  },
  {
    key: 'heavy-tail',
    label: "heavy tail (Student's t, 5 degrees of freedom)",
    draw: t5,
    mean: 0,
    median: 0,
    variance: 5 / 3,
    spread: 2 * 1.475884048824481,
    tol: {
      mean: se(Math.sqrt(5 / 3)),
      median: se(0.5 / 0.3796066898224944),
      variance: se(Math.sqrt(8 * (25 / 9))),
      spread: 2 * se(0.3 / 0.12828949200431738),
    },
  },
  {
    key: 'discrete',
    label: 'discrete (Poisson, mean 4)',
    draw: poisson4,
    mean: 4,
    median: 4,
    variance: 4,
    spread: 5,
    tol: { mean: se(2), median: 0, variance: se(6), spread: 0 },
  },
  {
    key: 'zero-variance',
    label: 'zero variance (every value 7)',
    draw: () => 7,
    mean: 7,
    median: 7,
    variance: 0,
    spread: 0,
    tol: { mean: 0, median: 0, variance: 0, spread: 0 },
  },
];

function distributionItems(): BankItem[] {
  const out: BankItem[] = [];
  const estimators: Array<{
    key: 'mean' | 'median' | 'variance' | 'spread';
    call: string;
    run(s: StatsImpl, v: number[]): number;
    component: string;
  }> = [
    { key: 'mean', call: 'mean(values)', run: (s, v) => s.mean(v), component: FILES.basics },
    {
      key: 'median',
      call: 'quantile(values, 0.5)',
      run: (s, v) => s.quantile(v, 0.5),
      component: FILES.basics,
    },
    {
      key: 'variance',
      call: 'sampleVariance(values)',
      run: (s, v) => s.sampleVariance(v),
      component: FILES.basics,
    },
    {
      key: 'spread',
      call: 'unreliability(values) (the 90th minus the 10th percentile)',
      run: (s, v) => s.unreliability(v),
      component: FILES.reliability,
    },
  ];
  for (const d of DISTS) {
    for (const e of estimators) {
      out.push(
        item(
          `analytic.distribution.${d.key}.${e.key}`,
          'estimators-distributions',
          3,
          e.component,
          ({ s, rng }) => {
            const values = Array.from({ length: N }, () => d.draw(rng));
            return guarded(
              e.call,
              () => e.run(s, values),
              (got) => {
                const truth = d[e.key];
                const tol = d.tol[e.key];
                return near(got, truth, tol)
                  ? ok()
                  : fail(
                      `${e.call} on ${N} draws from ${d.label} gave ${got}; the truth is ${truth} and a correct estimator lies within ${tol} of it (6 standard errors${tol === 0 ? ', here exact' : ''}).`,
                    );
              },
            );
          },
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family binomial-exact: exact coverage of the rate intervals, the zero-failure count and pass^k, pass@k by
// enumeration.

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 0; i < k; i += 1) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}
function pmf(k: number, n: number, p: number): number {
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
/** The exact coverage of an interval method at (n, p): the chance, over k ~ Binomial(n, p), that it holds p. */
export function exactCoverage(
  intervals: Array<{ lower: number; upper: number }>,
  n: number,
  p: number,
): number {
  let c = 0;
  for (let k = 0; k <= n; k += 1) {
    const ci = intervals[k] as { lower: number; upper: number };
    if (ci.lower <= p && p <= ci.upper) c += pmf(k, n, p);
  }
  return c;
}
export const grid = (lo: number, hi: number, count: number) =>
  Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));

function binomialItems(): BankItem[] {
  const out: BankItem[] = [];
  const sizes = [5, 10, 20, 50, 100, 200, 500];
  for (const n of sizes) {
    out.push(
      item(`analytic.binomial.wilson-mean-coverage.n${n}`, 'binomial-exact', 3, FILES.intervals, ({ s }) =>
        guarded(
          `wilson(k, ${n}) for k = 0..${n}`,
          () => Array.from({ length: n + 1 }, (_, k) => s.wilson(k, n)),
          (ivs) => {
            const mean = grid(0.01, 0.99, 197).reduce((a, p) => a + exactCoverage(ivs, n, p), 0) / 197;
            return mean >= 0.945
              ? ok()
              : fail(
                  `the exact coverage of wilson(k, ${n}) averaged over p from 0.01 to 0.99 is ${mean}; the Wilson interval averages 0.9504 to 0.9538 at n from 5 to 500 (Brown, Cai and DasGupta 2001), so it must reach 0.945.`,
                );
          },
        ),
      ),
    );
    out.push(
      item(`analytic.binomial.wilson-skew-coverage.n${n}`, 'binomial-exact', 4, FILES.intervals, ({ s }) =>
        guarded(
          `wilson(k, ${n})`,
          () => Array.from({ length: n + 1 }, (_, k) => s.wilson(k, n)),
          (ivs) => {
            const mean = grid(0.01, 0.1, 46).reduce((a, p) => a + exactCoverage(ivs, n, p), 0) / 46;
            return mean >= 0.93
              ? ok()
              : fail(
                  `the exact coverage of wilson(k, ${n}) averaged over skewed rates p from 0.01 to 0.1 is ${mean}; a correct Wilson interval gives 0.9365 or more there (n >= 5), so it must reach 0.93.`,
                );
          },
        ),
      ),
    );
    out.push(
      item(`analytic.binomial.clopper-pearson-minimum.n${n}`, 'binomial-exact', 3, FILES.intervals, ({ s }) =>
        guarded(
          `clopperPearson(k, ${n})`,
          () => Array.from({ length: n + 1 }, (_, k) => s.clopperPearson(k, n)),
          (ivs) => {
            const worst = Math.min(...grid(0.01, 0.99, 197).map((p) => exactCoverage(ivs, n, p)));
            return worst >= 0.95 - 1e-9
              ? ok()
              : fail(
                  `clopperPearson(k, ${n}) has exact coverage ${worst} at some p in [0.01, 0.99]; the exact interval never covers less than 0.95 by construction.`,
                );
          },
        ),
      ),
    );
  }
  for (const [p, alpha] of [
    [0.05, 0.05],
    [0.01, 0.05],
    [0.001, 0.01],
    [0.2, 0.1],
  ] as const) {
    out.push(
      item(`analytic.binomial.zero-failure.p${p}.a${alpha}`, 'binomial-exact', 2, FILES.intervals, ({ s }) =>
        guarded(
          `zeroFailureBound(${p}, ${alpha})`,
          () => s.zeroFailureBound(p, alpha),
          (got) => {
            let n = 1;
            while ((1 - p) ** n > alpha) n += 1;
            return got === n
              ? ok()
              : fail(
                  `zeroFailureBound(${p}, ${alpha}) gave ${got}; the smallest n with (1 - ${p})^n <= ${alpha}, found by counting up, is ${n}.`,
                );
          },
        ),
      ),
    );
  }
  // pass^k and pass@k by enumerating every k-subset of n runs, c of which passed.
  const subsets = (n: number, k: number): number[][] => {
    const all: number[][] = [];
    const walk = (start: number, chosen: number[]) => {
      if (chosen.length === k) {
        all.push([...chosen]);
        return;
      }
      for (let i = start; i < n; i += 1) walk(i + 1, [...chosen, i]);
    };
    walk(0, []);
    return all;
  };
  for (const [c, n, k] of [
    [5, 8, 3],
    [2, 9, 4],
    [9, 12, 5],
  ] as const) {
    const sets = subsets(n, k);
    const all = sets.filter((set) => set.every((i) => i < c)).length / sets.length;
    const any = sets.filter((set) => set.some((i) => i < c)).length / sets.length;
    out.push(
      item(`analytic.binomial.passk.c${c}n${n}k${k}`, 'binomial-exact', 2, FILES.reliability, ({ s }) =>
        guarded(
          `passK(${c}, ${n}, ${k})`,
          () => s.passK(c, n, k),
          (got) =>
            near(got, all, 1e-12)
              ? ok()
              : fail(
                  `passK(${c}, ${n}, ${k}) gave ${got}; counting all ${sets.length} subsets of ${k} runs gives ${all}.`,
                ),
        ),
      ),
      item(`analytic.binomial.passatk.c${c}n${n}k${k}`, 'binomial-exact', 2, FILES.reliability, ({ s }) =>
        guarded(
          `passAtK(${c}, ${n}, ${k})`,
          () => s.passAtK(c, n, k),
          (got) =>
            near(got, any, 1e-12)
              ? ok()
              : fail(
                  `passAtK(${c}, ${n}, ${k}) gave ${got}; counting all ${sets.length} subsets of ${k} runs gives ${any}.`,
                ),
        ),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family tests-calibration: exact p-values against brute-force enumeration of the null distribution.

function combinations(n: number, k: number): number[][] {
  const all: number[][] = [];
  const walk = (start: number, chosen: number[]) => {
    if (chosen.length === k) {
      all.push([...chosen]);
      return;
    }
    for (let i = start; i < n; i += 1) walk(i + 1, [...chosen, i]);
  };
  walk(0, []);
  return all;
}
function ksStatistic(a: number[], b: number[]): number {
  let d = 0;
  for (const x of [...a, ...b]) {
    const fa = a.filter((v) => v <= x).length / a.length;
    const fb = b.filter((v) => v <= x).length / b.length;
    d = Math.max(d, Math.abs(fa - fb));
  }
  return d;
}
function distinct(rng: () => number, n: number): number[] {
  const set = new Set<number>();
  while (set.size < n) set.add(Math.round(rng() * 1e6) / 1e3);
  return [...set];
}

function testItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const [m, n] of [
    [3, 3],
    [4, 3],
    [5, 4],
    [6, 5],
    [4, 7],
    [8, 6],
  ] as const) {
    out.push(
      item(`analytic.tests.ks-exact.m${m}n${n}`, 'tests-calibration', 3, FILES.drift, ({ s, rng }) => {
        const pooled = distinct(rng, m + n);
        const a = pooled.slice(0, m);
        const b = pooled.slice(m);
        const observed = ksStatistic(a, b);
        const splits = combinations(m + n, m);
        const extreme = splits.filter((idx) => {
          const set = new Set(idx);
          const x = pooled.filter((_, i) => set.has(i));
          const y = pooled.filter((_, i) => !set.has(i));
          return ksStatistic(x, y) >= observed - 1e-12;
        }).length;
        const truth = extreme / splits.length;
        return guarded(
          `ksTest(${show(a)}, ${show(b)})`,
          () => s.ksTest(a, b, { method: 'exact' }),
          (r) =>
            near(r.statistic, observed, 1e-12) && near(r.pValue, truth, 1e-9)
              ? ok()
              : fail(
                  `ksTest(${show(a)}, ${show(b)}, exact) gave statistic ${r.statistic}, p ${r.pValue}; enumerating all ${splits.length} splits gives statistic ${observed} and p ${truth}.`,
                ),
        );
      }),
    );
  }
  for (const n of [4, 6, 8, 9, 10]) {
    out.push(
      item(`analytic.tests.wilcoxon-exact.n${n}`, 'tests-calibration', 3, FILES.paired, ({ s, rng }) => {
        const diffs = distinct(rng, n).map((v, i) => (i % 3 === 0 ? -v : v));
        const x = diffs.map((d) => d + 10);
        const y = diffs.map(() => 10);
        const ranks = diffs
          .map((d, i) => [Math.abs(d), i] as const)
          .sort((p, q) => p[0] - q[0])
          .reduce<number[]>((acc, [, i], r) => {
            acc[i] = r + 1;
            return acc;
          }, []);
        const wPlus = diffs.reduce((acc, d, i) => acc + (d > 0 ? (ranks[i] as number) : 0), 0);
        const total = (n * (n + 1)) / 2;
        const stat = Math.min(wPlus, total - wPlus);
        let extreme = 0;
        for (let mask = 0; mask < 2 ** n; mask += 1) {
          let w = 0;
          for (let i = 0; i < n; i += 1) if (mask & (1 << i)) w += i + 1;
          if (Math.min(w, total - w) <= stat) extreme += 1;
        }
        const truth = Math.min(1, extreme / 2 ** n);
        return guarded(
          `wilcoxonSignedRank(x, y) with differences ${show(diffs)}`,
          () => s.wilcoxonSignedRank(x, y, { method: 'exact' }),
          (r) =>
            near(r.pValue, truth, 1e-9)
              ? ok()
              : fail(
                  `wilcoxonSignedRank on differences ${show(diffs)} (exact) gave p ${r.pValue}; enumerating all ${2 ** n} sign flips gives ${truth}.`,
                ),
        );
      }),
    );
  }
  for (const [b, c] of [
    [1, 7],
    [3, 9],
    [10, 4],
    [0, 6],
  ] as const) {
    out.push(
      item(`analytic.tests.mcnemar-exact.b${b}c${c}`, 'tests-calibration', 2, FILES.paired, ({ s }) => {
        const n = b + c;
        const k = Math.min(b, c);
        let tail = 0;
        for (let i = 0; i <= k; i += 1) tail += pmf(i, n, 0.5);
        const truth = Math.min(1, 2 * tail);
        return guarded(
          `mcnemar(${b}, ${c}, { exact: true })`,
          () => s.mcnemar(b, c, { exact: true }),
          (r) =>
            near(r.pValue, truth, 1e-12)
              ? ok()
              : fail(
                  `mcnemar(${b}, ${c}, exact) gave p ${r.pValue}; the exact binomial test of ${k} of ${n} at 0.5, two-sided, is ${truth}.`,
                ),
        );
      }),
    );
  }
  for (const n of [6, 12, 25]) {
    out.push(
      item(`analytic.tests.mcnemar-size.n${n}`, 'tests-calibration', 3, FILES.paired, ({ s }) =>
        guarded(
          `mcnemar(b, ${n} - b, exact) for b = 0..${n}`,
          () => Array.from({ length: n + 1 }, (_, b) => s.mcnemar(b, n - b, { exact: true }).pValue),
          (ps) => {
            const size = ps.reduce((acc, p, b) => acc + (p <= 0.05 ? pmf(b, n, 0.5) : 0), 0);
            return size <= 0.05 + 1e-12
              ? ok()
              : fail(
                  `the exact McNemar test with ${n} discordant pairs rejects a true null with probability ${size} at alpha 0.05; an exact test never exceeds 0.05.`,
                );
          },
        ),
      ),
    );
  }
  for (const m of [5, 9, 14, 20]) {
    out.push(
      item(`analytic.tests.bh-definition.m${m}`, 'tests-calibration', 2, FILES.multiple, ({ s, rng }) => {
        const p = Array.from({ length: m }, () => Math.round(rng() ** 3 * 1e6) / 1e6);
        const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
        const truth = new Array<number>(m);
        for (let r = 0; r < m; r += 1) {
          let best = 1;
          for (let j = r; j < m; j += 1)
            best = Math.min(best, ((order[j] as readonly [number, number])[0] * m) / (j + 1));
          truth[(order[r] as readonly [number, number])[1]] = best;
        }
        return guarded(
          `benjaminiHochberg(${show(p)})`,
          () => s.benjaminiHochberg(p, 0.1),
          (r) => {
            const bad = truth.findIndex(
              (t, i) => !near(r.adjusted[i] as number, t, 1e-12) || r.rejected[i] !== t <= 0.1,
            );
            return bad < 0
              ? ok()
              : fail(
                  `benjaminiHochberg(${show(p)}, 0.1) entry ${bad}: adjusted ${r.adjusted[bad]}, rejected ${r.rejected[bad]}; the definition min over j >= rank of m p(j) / j gives ${truth[bad]}.`,
                );
          },
        );
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family agreement-analytic: kappa and alpha against the formula written here.

function kappaTruth(
  a: string[],
  b: string[],
  cats: string[],
  weights: 'none' | 'linear' | 'quadratic',
): number {
  const n = a.length;
  const k = cats.length;
  const idx = new Map(cats.map((c, i) => [c, i]));
  const o = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  a.forEach((x, i) => {
    const row = o[idx.get(x) as number] as number[];
    const col = idx.get(b[i] as string) as number;
    row[col] = (row[col] as number) + 1 / n;
  });
  const rows = o.map((r) => r.reduce((x, y) => x + y, 0));
  const cols = cats.map((_, j) => o.reduce((x, r) => x + (r[j] as number), 0));
  const w = (i: number, j: number) =>
    weights === 'none' ? (i === j ? 0 : 1) : weights === 'linear' ? Math.abs(i - j) : (i - j) ** 2;
  let wo = 0;
  let we = 0;
  for (let i = 0; i < k; i += 1)
    for (let j = 0; j < k; j += 1) {
      wo += w(i, j) * ((o[i] as number[])[j] as number);
      we += w(i, j) * (rows[i] as number) * (cols[j] as number);
    }
  return 1 - wo / we;
}
function alphaTruth(a: number[], b: number[], level: 'nominal' | 'interval'): number {
  // Two coders, no missing value: the coincidence form, Do = mean pair distance, De over all 2N values.
  const values = [...a, ...b];
  const n = values.length;
  const d = (x: number, y: number) => (level === 'nominal' ? (x === y ? 0 : 1) : (x - y) ** 2);
  let doSum = 0;
  a.forEach((x, i) => {
    doSum += 2 * d(x, b[i] as number);
  });
  let deSum = 0;
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1) if (i !== j) deSum += d(values[i] as number, values[j] as number);
  return 1 - ((n - 1) * doSum) / deSum;
}

function agreementItems(): BankItem[] {
  const out: BankItem[] = [];
  const cats = ['a', 'b', 'c', 'd'];
  const raters = (rng: () => number, n: number, agree: number) => {
    const a = Array.from({ length: n }, () => cats[Math.floor(rng() * 4)] as string);
    const b = a.map((x) => (rng() < agree ? x : (cats[Math.floor(rng() * 4)] as string)));
    return { a, b };
  };
  const plan: Array<['none' | 'linear' | 'quadratic', number]> = [
    ['none', 0.7],
    ['none', 0.3],
    ['none', 0.95],
    ['none', 0],
    ['linear', 0.6],
    ['linear', 0.2],
    ['linear', 0.9],
    ['quadratic', 0.5],
    ['quadratic', 0.8],
    ['quadratic', 0.1],
  ];
  plan.forEach(([weights, agree], i) => {
    out.push(
      item(
        `analytic.agreement.kappa-${weights}.${i + 1}`,
        'agreement-analytic',
        2,
        FILES.agreement,
        ({ s, rng }) => {
          const { a, b } = raters(rng, 60, agree);
          const truth = kappaTruth(a, b, cats, weights);
          return guarded(
            `cohenKappa(a, b, { weights: '${weights}', categories: a..d })`,
            () => s.cohenKappa(a, b, { weights, categories: cats }),
            (r) =>
              near(r.kappa, truth, 1e-12)
                ? ok()
                : fail(
                    `cohenKappa on 60 drawn item pairs (agreement ${agree}, weights ${weights}) gave ${r.kappa}; 1 - sum(w o) / sum(w e) on the observed table gives ${truth}.`,
                  ),
          );
        },
      ),
    );
  });
  for (let i = 0; i < 3; i += 1) {
    out.push(
      item(
        `analytic.agreement.kappa-relabel.${i + 1}`,
        'agreement-analytic',
        2,
        FILES.agreement,
        ({ s, rng }) => {
          const { a, b } = raters(rng, 40, 0.6);
          const map: Record<string, string> = { a: 'q', b: 'r', c: 's', d: 't' };
          return guarded(
            'cohenKappa on relabelled categories',
            () => [
              s.cohenKappa(a, b).kappa,
              s.cohenKappa(
                a.map((x) => map[x] as string),
                b.map((x) => map[x] as string),
              ).kappa,
            ],
            ([k1, k2]) =>
              near(k1 as number, k2 as number, 1e-12)
                ? ok()
                : fail(
                    `unweighted cohenKappa changed from ${k1} to ${k2} when the four labels were renamed; unweighted kappa does not depend on the names.`,
                  ),
          );
        },
      ),
    );
  }
  for (const [level, k] of [
    ['nominal', 1],
    ['nominal', 2],
    ['nominal', 3],
    ['nominal', 4],
    ['interval', 1],
    ['interval', 2],
    ['interval', 3],
  ] as const) {
    out.push(
      item(
        `analytic.agreement.alpha-${level}.${k}`,
        'agreement-analytic',
        3,
        FILES.agreement,
        ({ s, rng }) => {
          const a = Array.from({ length: 30 }, () => 1 + Math.floor(rng() * 5));
          const b = a.map((x) => (rng() < 0.6 ? x : 1 + Math.floor(rng() * 5)));
          const truth = alphaTruth(a, b, level);
          return guarded(
            `krippendorffAlpha([a, b], { level: '${level}' })`,
            () => s.krippendorffAlpha([a, b], { level }),
            (r) =>
              near(r.alpha, truth, 1e-12)
                ? ok()
                : fail(
                    `krippendorffAlpha of two coders on 30 units (${level}) gave ${r.alpha}; the coincidence formula 1 - (N - 1) Do / De gives ${truth}.`,
                  ),
          );
        },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family unseen-known: Good-Turing, Chao and Hill on populations whose classes and shares are known.

type Pop = { key: string; probs: number[] };
function population(classes: number, spread: number): number[] {
  const w = Array.from({ length: classes }, (_, i) => spread ** (-i / (classes - 1)));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / t);
}
const POPS: Pop[] = [
  { key: 's20-even', probs: population(20, 1) },
  { key: 's40-tail5', probs: population(40, 5) },
  { key: 's80-tail10', probs: population(80, 10) },
  { key: 's150-tail3', probs: population(150, 3) },
];
const CHAO1_FORMULA_DESIGNS = new Set(['s20-even.x1.5', 's40-tail5.x1.5', 's80-tail10.x1.5', 's20-even.x3']);

/**
 * The sampling law of the mean relative error |Chao1 - S| / S of classic Chao1 over 100 samples, for the planted
 * designs that keep an accuracy demand. Simulated, not exact: `draws` multinomial samples of the design give the
 * per-sample mean, standard deviation and skewness, and their means in hundreds give the quantiles. `lower` and
 * `upper` are the empirical 0.0004 and 0.9996 quantiles of those means, rounded outward to four decimals, so a
 * correct implementation leaves the interval on fewer than `alpha` of the seeds. Recomputed by
 * packages/validators/test/stats/chao1-near-law.test.ts.
 */
export type Chao1ErrorLaw = {
  draws: number;
  mean: number;
  sd: number;
  skew: number;
  alpha: number;
  lower: number;
  upper: number;
};
export const CHAO1_ERROR_LAWS: Record<string, Chao1ErrorLaw> = {
  // 200,000,000 samples, 2,000,000 means; 0.000384 of the means fall below `lower` and 0.000392 above `upper`.
  's40-tail5.x3': {
    draws: 200_000_000,
    mean: 0.0801709293,
    sd: 0.093125748,
    skew: 6.4054205,
    alpha: 0.001,
    lower: 0.0559,
    upper: 0.1246,
  },
};

function sample(rng: () => number, probs: number[], n: number): number[] {
  const cum: number[] = [];
  let r = 0;
  for (const p of probs) {
    r += p;
    cum.push(r);
  }
  const counts = new Array<number>(probs.length).fill(0);
  for (let i = 0; i < n; i += 1) {
    const u = rng();
    let j = cum.findIndex((c) => u < c);
    if (j < 0) j = probs.length - 1;
    counts[j] = (counts[j] as number) + 1;
  }
  return counts;
}
/**
 * Average four independent samples at the original depth per class to reduce sampling noise without
 * changing the estimator's bias. One sample falsely failed Chao1 s80-tail10 on 14/20000 seeds, q1 s40-tail5
 * on 3/20000 and q2 s40-tail5 on 1/20000. Keep the Chao1 bar and tighten both Hill bars after averaging.
 * Reproduce the measured tails and planted-fault comparison with tools/stats/unseen-tails.ts; the evidence
 * is in validators/stats/evidence/unseen-tails.json. These are population-accuracy demands; the low-sample
 * Chao1 items separately check the finite-sample formula, which large samples often cannot distinguish.
 */
const UNSEEN_SAMPLES = 4;
const UNSEEN_BARS = { chao1: 0.05, q1: 0.035, q2: 0.06 } as const;

function meanOver(times: number, draw: () => number): number {
  let sum = 0;
  for (let i = 0; i < times; i += 1) sum += draw();
  return sum / times;
}
const hillTrue = (probs: number[], q: number) =>
  q === 1
    ? Math.exp(-probs.reduce((a, p) => a + p * Math.log(p), 0))
    : probs.reduce((a, p) => a + p ** q, 0) ** (1 / (1 - q));

/**
 * The finite-sample classic Chao1 pinned by statistics.md's reference-fixture contract.
 * Chao (1984), Eq. 6, derives the classic richness lower bound; the reference fixtures
 * retain the (n - 1) / n correction and the zero-doubleton fallback of coverage.ts.
 * Compute from the input counts, never the implementation's reported frequencies.
 */
function classicChao1(counts: readonly number[]): number {
  const n = counts.reduce((sum, count) => sum + count, 0);
  const observed = counts.filter((count) => count > 0).length;
  const f1 = counts.filter((count) => count === 1).length;
  const f2 = counts.filter((count) => count === 2).length;
  const unseen = f2 > 0 ? (f1 * f1) / (2 * f2) : (f1 * (f1 - 1)) / 2;
  return observed + ((n - 1) / n) * unseen;
}

function unseenItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const pop of POPS) {
    const S = pop.probs.length;
    out.push(
      item(`analytic.unseen.good-turing.${pop.key}`, 'unseen-known', 3, FILES.coverage, ({ s, rng }) => {
        // E[f1 / n] = sum p (1 - p)^(n - 1) exactly; the Monte Carlo mean of the estimator must match it.
        const n = 2 * S;
        const expected = pop.probs.reduce((a, p) => a + p * (1 - p) ** (n - 1), 0);
        const draws = 400;
        const values: number[] = [];
        for (let d = 0; d < draws; d += 1)
          values.push(s.goodTuring(sample(rng, pop.probs, n)).discoveryProbability);
        const m = values.reduce((a, b) => a + b, 0) / draws;
        const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (draws - 1));
        const tol = (5 * sd) / Math.sqrt(draws) + 1e-12;
        return Math.abs(m - expected) <= tol
          ? ok()
          : fail(
              `goodTuring(counts).discoveryProbability averaged ${m} over ${draws} samples of ${n} draws from ${S} known classes (${pop.key}); its exact expectation, sum p (1 - p)^(n - 1), is ${expected} (tolerance ${tol}, 5 Monte Carlo standard errors). The estimate must be f1 / n.`,
            );
      }),
      item(`analytic.unseen.chao-coverage.${pop.key}`, 'unseen-known', 3, FILES.coverage, ({ s, rng }) => {
        let err = 0;
        const draws = 100;
        for (let d = 0; d < draws; d += 1) {
          const counts = sample(rng, pop.probs, 4 * S);
          const seen = pop.probs.reduce((a, p, i) => a + ((counts[i] as number) > 0 ? p : 0), 0);
          err += Math.abs(s.chaoCoverage(counts).coverage - seen);
        }
        err /= draws;
        return err <= 0.05
          ? ok()
          : fail(
              `chaoCoverage(counts).coverage on ${4 * S} draws from ${S} known classes (${pop.key}) misses the true covered probability by ${err} on average over ${draws} samples; the Chao form is within 0.05 at four draws per class.`,
            );
      }),
      ...[1.5, 3].map((multiple) => ({
        ...item(
          `analytic.unseen.chao1-near.${pop.key}.x${multiple}`,
          'unseen-known',
          4,
          FILES.coverage,
          ({ s, rng }) => {
            const n = Math.round(multiple * S);
            let err = 0;
            const draws = 100;
            if (CHAO1_FORMULA_DESIGNS.has(`${pop.key}.x${multiple}`)) {
              // These four items used an unsupported 10%-from-truth demand on a lower bound.
              // Preserve their seeded low-sample inputs, but assert the promised estimator itself.
              for (let d = 0; d < draws; d += 1) {
                const counts = sample(rng, pop.probs, n);
                const want = classicChao1(counts);
                const got = s.chaoCoverage(counts).chao1;
                if (!near(got, want, REFERENCE_TOLERANCE))
                  return fail(
                    `chaoCoverage(counts).chao1 on draw ${d} from ${pop.key}, counts ${show(counts)}: got ${got}, expected classic Chao1 ${want} from the reference formula (Chao 1984 Eq. 6, finite-sample correction and zero-doubleton fallback); population accuracy is not this contract.`,
                  );
              }
              return ok(`${draws} low-sample draws match classic Chao1`);
            }
            const law = CHAO1_ERROR_LAWS[`${pop.key}.x${multiple}`];
            if (law) {
              // A 10 percent bar on this design failed a correct implementation on about 3 seeds in 100. The
              // estimator is held to the reference formula on every draw; the accuracy the old bar measured is
              // held to its sampling law, computed from the reference so a wrong estimate cannot move it.
              for (let d = 0; d < draws; d += 1) {
                const counts = sample(rng, pop.probs, n);
                const want = classicChao1(counts);
                const got = s.chaoCoverage(counts).chao1;
                if (!near(got, want, REFERENCE_TOLERANCE))
                  return fail(
                    `chaoCoverage(counts).chao1 on draw ${d} from ${pop.key}, counts ${show(counts)}: got ${got}, expected classic Chao1 ${want} from the reference formula (Chao 1984 Eq. 6, finite-sample correction and zero-doubleton fallback).`,
                  );
                err += Math.abs(want - S) / S;
              }
              err /= draws;
              return law.lower <= err && err <= law.upper
                ? ok(
                    `${draws} draws match classic Chao1; mean error ${err} inside [${law.lower}, ${law.upper}]`,
                  )
                : fail(
                    `classic Chao1 on ${n} draws (${multiple} times the class count) from ${S} known classes (${pop.key}) misses the true count by ${err} on average over ${draws} samples; its sampling law puts that mean in [${law.lower}, ${law.upper}] on all but ${law.alpha} of the seeds (per-sample mean ${law.mean}, sd ${law.sd}). The samples do not follow the planted population.`,
                  );
            }
            for (let d = 0; d < draws; d += 1)
              err += Math.abs(s.chaoCoverage(sample(rng, pop.probs, n)).chao1 - S) / S;
            err /= draws;
            return err <= 0.1
              ? ok()
              : fail(
                  `chaoCoverage(counts).chao1 on ${n} draws (${multiple} times the class count) from ${S} known classes (${pop.key}) misses the true count by ${err} on average over ${draws} samples; this specified planted design asks for average error below 10 percent. Classic Chao1 remains the reference contract; a different richness estimator cannot be substituted into this field.`,
                );
          },
        ),
        cause:
          CHAO1_FORMULA_DESIGNS.has(`${pop.key}.x${multiple}`) || CHAO1_ERROR_LAWS[`${pop.key}.x${multiple}`]
            ? 'chaoCoverage.chao1 differs from the classic finite-sample reference formula on low-sample counts'
            : 'chaoCoverage gives a richness estimate more than 10 percent off when the sample sits just above the class count',
      })),
      item(`analytic.unseen.chao1-large.${pop.key}`, 'unseen-known', 3, FILES.coverage, ({ s, rng }) => {
        const got = meanOver(UNSEEN_SAMPLES, () => s.chaoCoverage(sample(rng, pop.probs, 20 * S)).chao1);
        return Math.abs(got - S) / S <= UNSEEN_BARS.chao1
          ? ok()
          : fail(
              `chaoCoverage(counts).chao1 averaged over ${UNSEEN_SAMPLES} samples of ${20 * S} draws from ${S} known classes (${pop.key}) gave ${got}; with 20 draws per class the mean Chao1 is within ${100 * UNSEEN_BARS.chao1} percent of ${S}.`,
            );
      }),
      item(`analytic.unseen.hill-q1.${pop.key}`, 'unseen-known', 3, FILES.coverage, ({ s, rng }) => {
        const truth = hillTrue(pop.probs, 1);
        const got = meanOver(UNSEEN_SAMPLES, () => s.hillNumbers(sample(rng, pop.probs, 50 * S)).q1);
        return Math.abs(got - truth) / truth <= UNSEEN_BARS.q1
          ? ok()
          : fail(
              `hillNumbers(counts).q1 averaged over ${UNSEEN_SAMPLES} samples of ${50 * S} draws from ${pop.key} gave ${got}; the population's exp(Shannon) is ${truth} and the mean plug-in value is within ${100 * UNSEEN_BARS.q1} percent at 50 draws per class (it is biased down by about 1 percent).`,
            );
      }),
      item(`analytic.unseen.hill-q2.${pop.key}`, 'unseen-known', 3, FILES.coverage, ({ s, rng }) => {
        const truth = hillTrue(pop.probs, 2);
        const got = meanOver(UNSEEN_SAMPLES, () => s.hillNumbers(sample(rng, pop.probs, 50 * S)).q2);
        return Math.abs(got - truth) / truth <= UNSEEN_BARS.q2
          ? ok()
          : fail(
              `hillNumbers(counts).q2 averaged over ${UNSEEN_SAMPLES} samples of ${50 * S} draws from ${pop.key} gave ${got}; the population's inverse Simpson is ${truth} and the mean plug-in value is within ${100 * UNSEEN_BARS.q2} percent at 50 draws per class (the plug-in sum of p^2 is biased up by about 1 / n, so the value is biased down by 1 to 2 percent).`,
            );
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family allocation-bruteforce: Neyman allocation and repeats per block against exhaustive search.

function bestAllocation(
  sizes: number[],
  sds: number[],
  total: number,
): { alloc: number[]; variance: number } {
  // Minimise sum N_h^2 S_h^2 / n_h over integer n_h >= 1 with sum n_h = total (strata with S_h = 0 need none).
  const H = sizes.length;
  let best = { alloc: [] as number[], variance: Number.POSITIVE_INFINITY };
  const walk = (h: number, left: number, chosen: number[]) => {
    if (h === H - 1) {
      const alloc = [...chosen, left];
      let v = 0;
      for (let i = 0; i < H; i += 1) {
        const w = ((sizes[i] as number) * (sds[i] as number)) ** 2;
        if (w === 0) continue;
        if ((alloc[i] as number) === 0) return;
        v += w / (alloc[i] as number);
      }
      if (v < best.variance - 1e-12) best = { alloc, variance: v };
      return;
    }
    for (let n = 0; n <= left; n += 1) walk(h + 1, left - n, [...chosen, n]);
  };
  walk(0, total, []);
  return best;
}

function allocationItems(): BankItem[] {
  const out: BankItem[] = [];
  for (let i = 1; i <= 12; i += 1) {
    out.push(
      item(
        `analytic.allocation.neyman-optimal.${i}`,
        'allocation-bruteforce',
        4,
        FILES.variance,
        ({ s, rng }) => {
          const H = 3 + (i % 2);
          const sizes = Array.from({ length: H }, () => 10 + Math.floor(rng() * 90));
          const sds = Array.from({ length: H }, () => Math.round((0.05 + 0.45 * rng()) * 100) / 100);
          const total = 8 + Math.floor(rng() * 14);
          const best = bestAllocation(sizes, sds, total);
          const call = `neymanAllocation({ sizes: ${show(sizes)}, sds: ${show(sds)}, total: ${total} })`;
          return guarded(
            call,
            () => s.neymanAllocation({ sizes, sds, total }),
            (r) => {
              const v = r.allocated.reduce(
                (acc, n, h) => acc + ((sizes[h] as number) * (sds[h] as number)) ** 2 / n,
                0,
              );
              return v <= best.variance + 1e-9
                ? ok()
                : fail(
                    `${call} allocated ${show(r.allocated)}, variance sum N^2 S^2 / n = ${v}; exhaustive search over integer allocations finds ${show(best.alloc)} with ${best.variance}. Rounding the Neyman shares by largest remainder is not always optimal: allocate one unit at a time to the stratum with the largest drop in variance.`,
                  );
            },
          );
        },
      ),
    );
  }
  for (let i = 1; i <= 8; i += 1) {
    out.push(
      item(
        `analytic.allocation.repeats-floor.${i}`,
        'allocation-bruteforce',
        2,
        FILES.variance,
        ({ s, rng }) => {
          const variance = Math.round(rng() * 0.25 * 1e4) / 1e4;
          const floor = [0.02, 0.05, 0.1][i % 3] as number;
          const blocks = 1 + (i % 4);
          const z = 1.959963984540054;
          let r = 1;
          while (z * Math.sqrt((2 * variance) / (r * blocks)) > floor + 1e-15) r += 1;
          const call = `repeatsForFloor({ variance: ${variance}, floor: ${floor}, blocks: ${blocks} })`;
          return guarded(
            call,
            () => s.repeatsForFloor({ variance, floor, blocks }),
            (got) =>
              got.repeats === r
                ? ok()
                : fail(
                    `${call} gave ${got.repeats} repeats; counting up from 1, the first r with 1.96 sqrt(2 v / (r blocks)) <= floor is ${r}.`,
                  ),
          );
        },
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family variance-simulation: the variance components are unbiased on planted designs (direct simulation).

type Design = {
  key: string;
  cells: number;
  conversations: (c: number) => number;
  wordings: number;
  repeats: number;
};
const DESIGNS: Design[] = [
  { key: 'balanced-small', cells: 6, conversations: () => 4, wordings: 2, repeats: 3 },
  { key: 'balanced-wide', cells: 12, conversations: () => 3, wordings: 2, repeats: 2 },
  { key: 'unbalanced-conversations', cells: 8, conversations: (c) => 2 + (c % 4), wordings: 2, repeats: 3 },
  { key: 'unbalanced-deep', cells: 6, conversations: (c) => 3 + (c % 3), wordings: 3, repeats: 2 },
  { key: 'balanced-many-repeats', cells: 5, conversations: () => 3, wordings: 2, repeats: 6 },
];
const PLANT = [0.5, 0.3, 0.2, 1];

function varianceItems(): BankItem[] {
  const out: BankItem[] = [];
  const names = ['cell', 'conversation', 'wording', 'repeat'];
  for (const d of DESIGNS) {
    names.forEach((name, index) => {
      out.push(
        item(`analytic.variance.${d.key}.${name}`, 'variance-simulation', 4, FILES.variance, ({ s, rng }) => {
          const sims = 150;
          const estimates: number[] = [];
          for (let r = 0; r < sims; r += 1) {
            const obs: Observation[] = [];
            for (let c = 0; c < d.cells; c += 1) {
              const a = Math.sqrt(PLANT[0] as number) * normal(rng);
              for (let k = 0; k < d.conversations(c); k += 1) {
                const b = Math.sqrt(PLANT[1] as number) * normal(rng);
                for (let w = 0; w < d.wordings; w += 1) {
                  const e = Math.sqrt(PLANT[2] as number) * normal(rng);
                  for (let rep = 0; rep < d.repeats; rep += 1) {
                    obs.push({ value: a + b + e + normal(rng), path: [String(c), String(k), String(w)] });
                  }
                }
              }
            }
            const got = attempt(() => s.varianceComponents(obs));
            if (got.error)
              return fail(
                `varianceComponents threw ${got.error.name}: ${got.error.message} on a planted ${d.key} design`,
              );
            estimates.push(
              (
                (got.value as unknown as { components: Array<{ estimate: number }> }).components[index] as {
                  estimate: number;
                }
              ).estimate,
            );
          }
          const m = estimates.reduce((a, b) => a + b, 0) / sims;
          const sd = Math.sqrt(estimates.reduce((a, b) => a + (b - m) ** 2, 0) / (sims - 1));
          const truth = PLANT[index] as number;
          const tol = (5 * sd) / Math.sqrt(sims);
          return Math.abs(m - truth) <= tol
            ? ok()
            : fail(
                `varianceComponents on ${sims} simulated ${d.key} designs (planted cell 0.5, conversation 0.3, wording 0.2, repeat 1, normal effects): the ${name} estimate averages ${m}, truth ${truth}; an unbiased ANOVA (Henderson method I) estimate lies within ${tol} (5 Monte Carlo standard errors). Use the untruncated estimate.`,
              );
        }),
      );
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Family drift-analytic: CUSUM and Page-Hinkley on constructed series, the KS statistic by brute force.

function driftItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const [shift, start, h, k, dir] of [
    [1.5, 10, 5, 0.5, 'up'],
    [2, 20, 4, 0.5, 'up'],
    [3, 5, 5, 1, 'up'],
    [1, 30, 3, 0.25, 'up'],
    [1.2, 15, 6, 0.5, 'up'],
    [2.5, 8, 5, 0.5, 'up'],
    [1.5, 10, 5, 0.5, 'down'],
    [2, 12, 4, 0.5, 'down'],
    [3, 25, 8, 1, 'down'],
    [0.8, 10, 2, 0.25, 'down'],
  ] as const) {
    out.push(
      item(
        `analytic.drift.cusum-${dir}.s${shift}t${start}h${h}k${k}`,
        'drift-analytic',
        2,
        FILES.drift,
        ({ s }) => {
          const sign = dir === 'up' ? 1 : -1;
          const series = Array.from({ length: start + 40 }, (_, i) => (i < start ? 0 : sign * shift));
          // Noiseless: the statistic grows by (shift - k) per step after the change and alarms when it exceeds h.
          const steps = Math.floor(h / (shift - k)) + 1;
          const expected = start + steps - 1;
          const call = `cusum(${start} zeros then ${40} values of ${sign * shift}, { target: 0, sd: 1, k: ${k}, h: ${h} })`;
          return guarded(
            call,
            () => s.cusum(series, { target: 0, sd: 1, k, h }),
            (r) => {
              const first = r.alarms[0];
              return first && first.index === expected && first.direction === dir
                ? ok()
                : fail(
                    `${call} first alarmed at ${show(first)}; the statistic grows by ${shift - k} per step from index ${start}, so the first ${dir} alarm is at index ${expected}.`,
                  );
            },
          );
        },
      ),
    );
  }
  for (let i = 1; i <= 10; i += 1) {
    out.push(
      item(`analytic.drift.ks-statistic.${i}`, 'drift-analytic', 2, FILES.drift, ({ s, rng }) => {
        const a = Array.from({ length: 5 + i * 3 }, () => Math.round(normal(rng) * 100) / 100);
        const b = Array.from({ length: 4 + i * 2 }, () => Math.round((normal(rng) + 0.5) * 100) / 100);
        const truth = ksStatistic(a, b);
        return guarded(
          `ksTest(a, b) on ${a.length} and ${b.length} drawn values (ties allowed)`,
          () => s.ksTest(a, b),
          (r) =>
            near(r.statistic, truth, 1e-12)
              ? ok()
              : fail(
                  `ksTest statistic on ${show(a)} and ${show(b)} is ${r.statistic}; the largest gap between the two empirical cdfs, checked at every value, is ${truth}.`,
                ),
        );
      }),
    );
  }
  return out;
}

/** Every analytic item. */
export function analyticItems(): BankItem[] {
  return [
    ...distributionItems(),
    ...binomialItems(),
    ...testItems(),
    ...agreementItems(),
    ...unseenItems(),
    ...allocationItems(),
    ...varianceItems(),
    ...driftItems(),
  ];
}
