import type * as stats from '@agent-nexus/driftbench-stats';
import type { Item, Measure } from '../../ladder';

/** Level 1 of the statistics validator: every Python reference value matches the implementation. */

/** The Python reference values, from the repository root. Written by make_fixtures.py next to it. */
export const STATS_FIXTURES = 'packages/stats/test/reference/fixtures.json';

/** The tolerance every reference value is matched to (docs/validators.md section 7, level 1). */
export const REFERENCE_TOLERANCE = 1e-6;

/** The fixed table from a fixture group to the one source file an item points at. */
export const STATS_COMPONENTS: Record<string, string> = {
  special: 'packages/stats/src/special.ts',
  intervals: 'packages/stats/src/intervals.ts',
  bootstrap: 'packages/stats/src/intervals.ts',
  reliability: 'packages/stats/src/reliability.ts',
  mcnemar: 'packages/stats/src/paired.ts',
  wilcoxon: 'packages/stats/src/paired.ts',
  paired: 'packages/stats/src/paired.ts',
  benjaminiHochberg: 'packages/stats/src/multiple.ts',
  mde: 'packages/stats/src/power.ts',
  drift: 'packages/stats/src/drift.ts',
  kappa: 'packages/stats/src/agreement.ts',
  krippendorff: 'packages/stats/src/agreement.ts',
  varianceComponents: 'packages/stats/src/variance.ts',
  neyman: 'packages/stats/src/variance.ts',
  repeatsForFloor: 'packages/stats/src/variance.ts',
  coverage: 'packages/stats/src/coverage.ts',
};

/** The functions the ladder scores. Tests replace one to plant a fault. */
export type StatsImpl = typeof stats;

// biome-ignore lint/suspicious/noExplicitAny: the fixtures are JSON read as data; each case reads the fields it compares
export type Row = Record<string, any>;

/** One comparison: the function under test, run on one reference case. */
export type Case = { id: string; component: string; run(expect: Expect): void };
type Expect = {
  near(what: string, actual: number, expected: number, tolerance?: number): void;
  same(what: string, actual: unknown, expected: unknown): void;
};

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/** Every reference case of the fixtures, as comparisons against the implementation. */
export function referenceCases(fixtures: Row, s: StatsImpl): Case[] {
  const out: Case[] = [];
  const add = (group: string, name: string, index: number, run: Case['run']) =>
    out.push({
      id: `${group}.${name}[${index}]`,
      component: STATS_COMPONENTS[group] ?? 'packages/stats/src',
      run,
    });
  const special = fixtures.special ?? {};
  rows(special.logGamma).forEach((c, i) => {
    add('special', 'logGamma', i, (e) => e.near(`logGamma(${c.x})`, s.logGamma(c.x), c.expected));
  });
  rows(special.incompleteBeta).forEach((c, i) => {
    add('special', 'incompleteBeta', i, (e) =>
      e.near(`incompleteBeta(${c.x}, ${c.a}, ${c.b})`, s.incompleteBeta(c.x, c.a, c.b), c.expected),
    );
  });
  rows(special.betaQuantile).forEach((c, i) => {
    add('special', 'betaQuantile', i, (e) =>
      e.near(`betaQuantile(${c.p}, ${c.a}, ${c.b})`, s.betaQuantile(c.p, c.a, c.b), c.expected),
    );
  });
  rows(special.normalQuantile).forEach((c, i) => {
    add('special', 'normalQuantile', i, (e) =>
      e.near(`normalQuantile(${c.p})`, s.normalQuantile(c.p), c.expected),
    );
  });
  rows(special.normalCdf).forEach((c, i) => {
    add('special', 'normalCdf', i, (e) => e.near(`normalCdf(${c.z})`, s.normalCdf(c.z), c.expected));
  });
  rows(special.chiSquareSf).forEach((c, i) => {
    add('special', 'chiSquareSf', i, (e) =>
      e.near(`chiSquareSf(${c.x}, ${c.df})`, s.chiSquareSf(c.x, c.df), c.expected),
    );
  });
  rows(special.binomialCdf).forEach((c, i) => {
    add('special', 'binomialCdf', i, (e) =>
      e.near(`binomialCdf(${c.k}, ${c.n}, ${c.p})`, s.binomialCdf(c.k, c.n, c.p), c.expected),
    );
  });
  const intervals = fixtures.intervals ?? {};
  rows(intervals.wilson).forEach((c, i) => {
    add('intervals', 'wilson', i, (e) => {
      const ci = s.wilson(c.k, c.n, c.z);
      e.near('lower', ci.lower, c.lower);
      e.near('upper', ci.upper, c.upper);
      e.same('estimate', ci.estimate, c.k / c.n);
    });
  });
  rows(intervals.clopperPearson).forEach((c, i) => {
    add('intervals', 'clopperPearson', i, (e) => {
      const ci = s.clopperPearson(c.k, c.n, c.alpha);
      e.near('lower', ci.lower, c.lower);
      e.near('upper', ci.upper, c.upper);
    });
  });
  rows(intervals.zeroFailureBound).forEach((c, i) => {
    add('intervals', 'zeroFailureBound', i, (e) => e.same('n', s.zeroFailureBound(c.p, c.alpha), c.expected));
  });
  rows(intervals.designEffect).forEach((c, i) => {
    add('intervals', 'designEffect', i, (e) => e.near('deff', s.designEffect(c.m, c.rho), c.expected));
  });
  const bootstrap = fixtures.bootstrap ?? {};
  rows(bootstrap.replay).forEach((c, i) => {
    add('bootstrap', 'replay', i, (e) => {
      const ci = s.bootstrapCI(c.values, {
        ...(c.clusters ? { clusters: c.clusters } : {}),
        iterations: c.iterations,
        seed: c.seed,
        alpha: c.alpha,
        method: c.method,
      });
      e.near(`${c.name} estimate`, ci.estimate, c.estimate);
      e.near(`${c.name} lower`, ci.lower, c.lower);
      e.near(`${c.name} upper`, ci.upper, c.upper);
    });
  });
  if (bootstrap.independent) {
    const c = bootstrap.independent as Row;
    // A numpy bootstrap with another generator: the fixture carries its own tolerance.
    add('bootstrap', 'independent', 0, (e) => {
      const ci = s.bootstrapCI(c.values, {
        clusters: c.clusters,
        iterations: c.iterations,
        alpha: c.alpha,
        seed: 3,
      });
      e.near('lower', ci.lower, c.lower, c.tolerance);
      e.near('upper', ci.upper, c.upper, c.tolerance);
    });
  }
  const reliability = fixtures.reliability ?? {};
  rows(reliability.passK).forEach((c, i) => {
    add('reliability', 'passK', i, (e) =>
      e.near(`passK(${c.c}, ${c.n}, ${c.k})`, s.passK(c.c, c.n, c.k), c.expected),
    );
  });
  rows(reliability.passAtK).forEach((c, i) => {
    add('reliability', 'passAtK', i, (e) =>
      e.near(`passAtK(${c.c}, ${c.n}, ${c.k})`, s.passAtK(c.c, c.n, c.k), c.expected),
    );
  });
  rows(reliability.unreliability).forEach((c, i) => {
    add('reliability', 'unreliability', i, (e) =>
      e.near('unreliability', s.unreliability(c.samples), c.expected),
    );
  });
  rows(fixtures.mcnemar).forEach((c, i) => {
    add('mcnemar', 'mcnemar', i, (e) => {
      const r = s.mcnemar(c.b, c.c);
      e.same('method', r.method, c.method);
      e.near('statistic', r.statistic, c.statistic);
      e.near('pValue', r.pValue, c.pValue);
    });
  });
  rows(fixtures.wilcoxon).forEach((c, i) => {
    add('wilcoxon', 'wilcoxon', i, (e) => {
      const r = s.wilcoxonSignedRank(c.x, c.y);
      e.near(`${c.name} statistic`, r.statistic, c.statistic);
      e.near(`${c.name} pValue`, r.pValue, c.pValue);
    });
  });
  const paired = fixtures.paired ?? {};
  rows(paired.pairedRateDifference).forEach((c, i) => {
    add('paired', 'pairedRateDifference', i, (e) => {
      const r = s.pairedRateDifference(
        { bothPass: c.bothPass, regressed: c.regressed, improved: c.improved, bothFail: c.bothFail },
        c.alpha,
      );
      e.near('estimate', r.estimate, c.estimate);
      e.near('lower', r.lower, c.lower);
      e.near('upper', r.upper, c.upper);
    });
  });
  rows(paired.nonInferiority).forEach((c, i) => {
    add('paired', 'nonInferiority', i, (e) => {
      const r = s.nonInferiority({
        baseline: c.baseline,
        candidate: c.candidate,
        margin: c.margin,
        ...(c.gatingFlags ? { gatingFlags: c.gatingFlags } : {}),
      });
      e.same(`${c.name} nonInferior`, r.nonInferior, c.nonInferior);
      e.same(`${c.name} discordant`, r.discordant, { regressed: c.regressed, improved: c.improved });
      e.near(`${c.name} estimate`, r.effect.estimate, c.estimate);
      e.near(`${c.name} lower`, r.effect.lower, c.lower);
      e.near(`${c.name} upper`, r.effect.upper, c.upper);
    });
  });
  rows(fixtures.benjaminiHochberg).forEach((c, i) => {
    add('benjaminiHochberg', 'benjaminiHochberg', i, (e) => {
      const r = s.benjaminiHochberg(c.pvalues, c.q);
      e.same('length', r.adjusted.length, c.adjusted.length);
      r.adjusted.forEach((value: number, j: number) => {
        e.near(`adjusted[${j}]`, value, c.adjusted[j]);
      });
      e.same('rejected', r.rejected, c.rejected);
    });
  });
  rows(fixtures.mde).forEach((c, i) => {
    add('mde', 'mde', i, (e) => {
      const r = s.mde({
        n: c.n,
        repeats: c.repeats,
        baselineRate: c.baselineRate,
        power: c.power,
        alpha: c.alpha,
        rho: c.rho,
      });
      e.near('effectiveN', r.effectiveN, c.effectiveN);
      if (c.effect === null) e.same('effect', r.effect, null);
      else e.near('effect', r.effect as number, c.effect);
    });
  });
  const drift = fixtures.drift ?? {};
  rows(drift.cusum).forEach((c, i) => {
    add('drift', 'cusum', i, (e) => {
      const r = s.cusum(c.series, c.options);
      e.near(`${c.name} target`, r.target, c.target);
      e.near(`${c.name} sd`, r.sd, c.sd);
      nearAll(e, `${c.name} upper`, r.upper, c.upper);
      nearAll(e, `${c.name} lower`, r.lower, c.lower);
      e.same(`${c.name} alarms`, r.alarms, c.alarms);
    });
  });
  rows(drift.pageHinkley).forEach((c, i) => {
    add('drift', 'pageHinkley', i, (e) => {
      const r = s.pageHinkley(c.series, c.options);
      nearAll(e, `${c.name} up`, r.up, c.up);
      nearAll(e, `${c.name} down`, r.down, c.down);
      e.same(`${c.name} alarms`, r.alarms, c.alarms);
    });
  });
  rows(drift.ksTest).forEach((c, i) => {
    add('drift', 'ksTest', i, (e) => {
      const r = s.ksTest(c.a, c.b);
      e.same(`${c.name} method`, r.method, 'exact');
      e.near(`${c.name} statistic`, r.statistic, c.statistic);
      e.near(`${c.name} pValue`, r.pValue, c.pValue);
      e.near(
        `${c.name} asymptotic pValue`,
        s.ksTest(c.a, c.b, { method: 'asymptotic' }).pValue,
        c.asymptoticPValue,
      );
    });
  });
  rows(fixtures.kappa).forEach((c, i) => {
    add('kappa', 'kappa', i, (e) =>
      e.near(c.name, s.cohenKappa(c.a, c.b, { weights: c.weights }).kappa, c.kappa),
    );
  });
  rows(fixtures.krippendorff).forEach((c, i) => {
    add('krippendorff', 'krippendorff', i, (e) =>
      e.near(`${c.name} ${c.level}`, s.krippendorffAlpha(c.matrix, { level: c.level }).alpha, c.alpha),
    );
  });
  rows(fixtures.varianceComponents).forEach((c, i) => {
    add('varianceComponents', 'varianceComponents', i, (e) => {
      const r = s.varianceComponents(c.observations, c.levels ? { levels: c.levels } : {});
      e.same(`${c.name} balanced`, r.balanced, c.balanced);
      e.same(`${c.name} components`, r.components.length, c.df.length);
      r.components.forEach((comp, j) => {
        e.same(`${c.name} df ${comp.level}`, comp.df, c.df[j]);
        e.near(`${c.name} SS ${comp.level}`, comp.sumSquares, c.ss[j]);
        e.near(`${c.name} MS ${comp.level}`, comp.meanSquare, c.ms[j]);
        e.near(`${c.name} estimate ${comp.level}`, comp.estimate, c.estimates[j]);
      });
    });
  });
  rows(fixtures.neyman).forEach((c, i) => {
    add('neyman', 'neyman', i, (e) => {
      const r = s.neymanAllocation({ sizes: c.sizes, sds: c.sds, total: c.total });
      nearAll(e, 'exact', r.exact, c.exact);
      e.same('allocated', r.allocated, c.allocated);
    });
  });
  rows(fixtures.repeatsForFloor).forEach((c, i) => {
    add('repeatsForFloor', 'repeatsForFloor', i, (e) => {
      const r = s.repeatsForFloor(c.input);
      e.same('repeats', r.repeats, c.repeats);
      e.near('floor', r.floor, c.floor);
    });
  });
  rows(fixtures.coverage).forEach((c, i) => {
    add('coverage', 'coverage', i, (e) => {
      const gt = s.goodTuring(c.counts);
      e.same(`${c.name} counts`, [gt.n, gt.observed, gt.f1, gt.f2], [c.n, c.observed, c.f1, c.f2]);
      e.near(`${c.name} discovery`, gt.discoveryProbability, c.discoveryProbability);
      e.near(`${c.name} Turing coverage`, gt.coverage, c.turingCoverage);
      const ch = s.chaoCoverage(c.counts);
      e.near(`${c.name} Chao coverage`, ch.coverage, c.coverage);
      e.near(`${c.name} Chao1`, ch.chao1, c.chao1);
      const h = s.hillNumbers(c.counts);
      e.same(`${c.name} q0`, h.q0, c.q0);
      e.near(`${c.name} q1`, h.q1, c.q1);
      e.near(`${c.name} q2`, h.q2, c.q2);
      e.near(`${c.name} q3`, s.hillNumber(c.counts, 3), c.q3);
    });
  });
  return out;
}

function nearAll(e: Expect, what: string, actual: readonly number[], expected: readonly number[]): void {
  e.same(`${what} length`, actual.length, expected.length);
  actual.forEach((value, index) => {
    e.near(`${what}[${index}]`, value, expected[index] as number);
  });
}

/** Runs one case and returns its mismatches; a throw is one mismatch. */
export function check(item: Case): string[] {
  const misses: string[] = [];
  const expect: Expect = {
    near(what, actual, expected, tolerance = REFERENCE_TOLERANCE) {
      const diff = Math.abs(actual - expected);
      if (!(diff <= tolerance)) {
        misses.push(
          `${what}: got ${actual}, expected ${expected} (diff ${diff.toExponential(2)}, tolerance ${tolerance.toExponential()})`,
        );
      }
    },
    same(what, actual, expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        misses.push(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
    },
  };
  try {
    item.run(expect);
  } catch (cause) {
    misses.push(`threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return misses;
}

/** Level 1: every reference case matches. */
export function referenceLevel(fixtures: Row, s: StatsImpl): Measure {
  const cases = referenceCases(fixtures, s);
  const items: Item[] = [];
  for (const item of cases) {
    const misses = check(item);
    if (misses.length > 0) items.push({ id: item.id, component: item.component, detail: misses.join('; ') });
  }
  if (cases.length === 0) {
    return {
      value: 0,
      items: [{ id: 'fixtures:empty', component: STATS_FIXTURES, detail: 'no reference case was found' }],
    };
  }
  return { value: (cases.length - items.length) / cases.length, items };
}
