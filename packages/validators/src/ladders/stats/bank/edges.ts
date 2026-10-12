import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attempt, type BankItem, exported, fail, ok, show } from './item';

/**
 * Family `edge-accuracy` (level `analytic`, tier 4): each documented statistic on the edge inputs a report meets,
 * n = 1, all pass, all fail, ties, huge n, a tiny rate, against expected values from scipy, exact rationals or
 * 60-digit decimals (packages/validators/fixtures/stats/make_edges.py writes edges.json). Each case carries the
 * need it serves: the docs page or command that prints the value (validators/stats/NEEDS.md, "Depth").
 */

export const EDGES_FIXTURE = 'packages/validators/fixtures/stats/edges.json';

type Want = number | null | boolean | Want[] | { [key: string]: Want };
export type EdgeCase = {
  id: string;
  fn: string;
  edge: string;
  args: unknown[];
  want: Want;
  tol: number;
  rel: boolean;
  need: string;
};

const FILE_OF: Record<string, string> = {
  wilson: 'packages/stats/src/intervals.ts',
  clopperPearson: 'packages/stats/src/intervals.ts',
  zeroFailureBound: 'packages/stats/src/intervals.ts',
  passK: 'packages/stats/src/reliability.ts',
  passAtK: 'packages/stats/src/reliability.ts',
  mcnemar: 'packages/stats/src/paired.ts',
  wilcoxonSignedRank: 'packages/stats/src/paired.ts',
  ksTest: 'packages/stats/src/drift.ts',
  benjaminiHochberg: 'packages/stats/src/multiple.ts',
  cohenKappa: 'packages/stats/src/agreement.ts',
  krippendorffAlpha: 'packages/stats/src/agreement.ts',
  mde: 'packages/stats/src/power.ts',
};

const cache = new Map<string, EdgeCase[]>();
export function edgeCases(root: string): EdgeCase[] {
  const path = join(root, EDGES_FIXTURE);
  let cases = cache.get(path);
  if (!cases) {
    cases = (JSON.parse(readFileSync(path, 'utf8')) as { cases: EdgeCase[] }).cases;
    cache.set(path, cases);
  }
  return cases;
}

/** The first field where got differs from want, or undefined when every field of want matches. */
export function mismatch(got: unknown, want: Want, tol: number, rel: boolean, at = ''): string | undefined {
  if (want === null)
    return got === null || got === undefined ? undefined : `${at || 'value'} ${show(got)}, want null`;
  if (typeof want === 'boolean')
    return got === want ? undefined : `${at || 'value'} ${show(got)}, want ${want}`;
  if (typeof want === 'number') {
    if (typeof got !== 'number' || Number.isNaN(got)) return `${at || 'value'} ${show(got)}, want ${want}`;
    // Relative to the expected value, absolute when the expected value is 0.
    const allowed = rel && want !== 0 ? tol * Math.abs(want) : tol;
    return Math.abs(got - want) <= allowed
      ? undefined
      : `${at || 'value'} ${got}, want ${want} (tolerance ${allowed})`;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length)
      return `${at || 'value'} ${show(got)}, want ${want.length} entries ${show(want)}`;
    for (let i = 0; i < want.length; i += 1) {
      const m = mismatch(got[i], want[i] as Want, tol, rel, `${at}[${i}]`);
      if (m) return m;
    }
    return undefined;
  }
  if (typeof got !== 'object' || got === null)
    return `${at || 'value'} ${show(got)}, want an object ${show(want)}`;
  for (const [key, value] of Object.entries(want)) {
    const m = mismatch((got as Record<string, unknown>)[key], value, tol, rel, at ? `${at}.${key}` : key);
    if (m) return m;
  }
  return undefined;
}

export function edgeItems(root: string): BankItem[] {
  return edgeCases(root).map((c) => ({
    id: `edge.${c.id}`,
    family: 'edge-accuracy',
    tier: 4,
    level: 'analytic',
    component: FILE_OF[c.fn] ?? 'packages/stats/src/index.ts',
    cause: `${c.fn}: edge inputs`,
    check: ({ s }) => {
      const f = exported(s, c.fn);
      if (!f) return fail(`@driftbench/stats exports no function ${c.fn}.`);
      const call = `${c.fn}(${c.args.map((a) => show(a)).join(', ')})`;
      const got = attempt(() => (f as (...args: unknown[]) => unknown)(...c.args));
      if (got.error) return fail(`${call} threw ${got.error.name}: ${got.error.message}; edge: ${c.edge}.`);
      const m = mismatch(got.value, c.want, c.tol, c.rel);
      return m
        ? fail(
            `${call} on the edge "${c.edge}": ${m}. The expected value comes from make_edges.py (scipy, exact rationals or 60-digit decimals); the need: ${c.need}.`,
          )
        : ok();
    },
  }));
}

/**
 * The design effect 1 + (m - 1) rho is a variance ratio, so it is positive: rho can be negative only down to
 * -1 / (m - 1). Below that bound the formula gives zero or a negative design effect, a negative effective sample
 * size and, through mde, a square root of a negative number. The need: docs/concepts/statistics.md, designEffect
 * and effectiveSampleSize; docs/generating.md, the pilot's design effect.
 */
export function designBoundItems(): BankItem[] {
  const cases: Array<[string, string, (s: Record<string, (...a: never[]) => unknown>) => unknown]> = [
    [
      'design-effect',
      'designEffect(10, -0.5)',
      (s) => (s.designEffect as (m: number, r: number) => unknown)(10, -0.5),
    ],
    [
      'effective-size',
      'effectiveSampleSize(100, 10, -0.2)',
      (s) => (s.effectiveSampleSize as (n: number, m: number, r: number) => unknown)(100, 10, -0.2),
    ],
    [
      'mde',
      'mde({ n: 30, repeats: 5, baselineRate: 0.8, rho: -0.5 })',
      (s) => (s.mde as (input: object) => unknown)({ n: 30, repeats: 5, baselineRate: 0.8, rho: -0.5 }),
    ],
  ];
  return cases.map(([key, call, f]) => ({
    id: `edge.rho-bound.${key}`,
    family: 'edge-accuracy',
    tier: 4,
    level: 'analytic',
    component: key === 'mde' ? 'packages/stats/src/power.ts' : 'packages/stats/src/intervals.ts',
    cause: 'designEffect: reject rho below -1 / (m - 1)',
    check: ({ s }) => {
      const got = attempt(() => f(s as unknown as Record<string, (...a: never[]) => unknown>));
      if (got.error instanceof RangeError) return ok();
      return fail(
        got.error
          ? `${call} threw ${got.error.name}, want a RangeError: rho must be at least -1 / (m - 1).`
          : `${call} returned ${show(got.value)}; rho below -1 / (m - 1) gives a design effect of 0 or less, which no data can have. Throw a RangeError naming the bound.`,
      );
    },
  }));
}
