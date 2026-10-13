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
    cause: `${c.fn} differs from scipy or exact arithmetic on an edge input`,
    check: ({ s }) => {
      const f = exported(s, c.fn);
      if (!f) return fail(`@agent-nexus/driftbench-stats exports no function ${c.fn}.`);
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
    cause: 'designEffect accepts rho below -1 / (m - 1) and returns a design effect of 0 or less',
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

type Reduce = (values: readonly (number | undefined)[], reducer: unknown) => unknown;
type Parse = (spelling: string) => unknown;

/**
 * Documented rules at their exact boundaries, where a one-character change flips the answer (the planted bugs the
 * stats-v2 audit found no item for, validators/stats/audit.md): the Benjamini-Hochberg step-up threshold met with
 * equality, mde's default power and alpha, and the repeat reducers of docs/concepts/judges.md, "Repeat reducers".
 */
export function ruleItems(): BankItem[] {
  const REDUCERS = 'packages/stats/src/repeat-reducers.ts';
  const JUDGES = 'docs/concepts/judges.md, "Repeat reducers"';
  const rule = (id: string, component: string, cause: string, check: BankItem['check']): BankItem => ({
    id: `edge.rule.${id}`,
    family: 'edge-accuracy',
    tier: 3,
    level: 'analytic',
    component,
    cause,
    check,
  });
  const reduce = (
    s: Parameters<BankItem['check']>[0]['s'],
    values: (number | undefined)[],
    spelling: string,
  ) => {
    const parse = exported(s, 'parseRepeatReducer') as Parse | undefined;
    const r = exported(s, 'reduceRepeats') as Reduce | undefined;
    if (!parse || !r)
      return { error: '@agent-nexus/driftbench-stats exports no parseRepeatReducer or reduceRepeats' };
    const got = attempt(() => r(values, parse(spelling)));
    return got.error ? { error: `threw ${got.error.message}` } : { value: got.value };
  };
  const reducerCase = (
    id: string,
    cause: string,
    cases: Array<[(number | undefined)[], string, 0 | 1 | undefined]>,
    rule_: string,
  ): BankItem =>
    rule(id, REDUCERS, cause, ({ s }) => {
      for (const [values, spelling, want] of cases) {
        const got = reduce(s, values, spelling);
        if ('error' in got || got.value !== want)
          return fail(
            `reduceRepeats(${show(values)}, ${spelling}) gave ${'error' in got ? got.error : show(got.value)}, want ${show(want)}: ${rule_} (${JUDGES}).`,
          );
      }
      return ok();
    });
  return [
    rule(
      'benjamini-hochberg-equality',
      'packages/stats/src/multiple.ts',
      'benjaminiHochberg does not reject a p-value equal to its step-up threshold',
      ({ s }) => {
        // 0.25 = 1 x 0.5 / 2 and 0.5 = 2 x 0.5 / 2 exactly in binary: the rule p(k) <= k q / m holds with equality.
        const got = attempt(() => s.benjaminiHochberg([0.25, 0.5], 0.5));
        const r = got.value as { rejected?: boolean[]; threshold?: number | null } | undefined;
        return r && r.rejected?.[0] === true && r.rejected?.[1] === true && r.threshold === 0.5
          ? ok()
          : fail(
              `benjaminiHochberg([0.25, 0.5], 0.5) ${got.error ? `threw ${got.error.message}` : `gave ${show(got.value)}`}; want both rejected and threshold 0.5: the step-up rule rejects p(k) <= k q / m, equality included (Benjamini and Hochberg 1995). Need: driftbench compare and the pilot's wording test.`,
            );
      },
    ),
    rule(
      'mde-defaults',
      'packages/stats/src/power.ts',
      "mde's default power or alpha differs from the documented 0.8 and 0.05",
      ({ s }) => {
        const base = { n: 100, repeats: 2, baselineRate: 0.8, rho: 0.1 };
        const got = attempt(() => [s.mde(base).effect, s.mde({ ...base, power: 0.8, alpha: 0.05 }).effect]);
        const [byDefault, explicit] = got.value ?? [];
        return !got.error && typeof byDefault === 'number' && byDefault === explicit
          ? ok()
          : fail(
              `mde(${show(base)}) gave ${show(byDefault)} and mde with power 0.8 and alpha 0.05 written out gave ${show(explicit)}${got.error ? ` (threw ${got.error.message})` : ''}; docs/concepts/statistics.md documents power 0.8 and alpha 0.05 as the defaults. Need: campaign plan prints this effect.`,
            );
      },
    ),
    reducerCase(
      'mode-tie',
      'reduceRepeats breaks a mode tie toward a value other than the first seen',
      [
        [[0, 1, 1, 0], 'mode', 0],
        [[1, 0, 0, 1], 'mode', 1],
        [[1, undefined, 0, 0, 1], 'mode', 1],
      ],
      'a tie goes to the verdict seen first',
    ),
    reducerCase(
      'mode-half-scored',
      'reduceRepeats gives a mode verdict when only half the repeats are scored',
      [
        [[1, undefined], 'mode', undefined],
        [[1, 1, undefined, undefined], 'mode', undefined],
        [[1, 1, undefined], 'mode', 1],
      ],
      'mode needs more than half of the repeats scored',
    ),
    reducerCase(
      'median-half',
      'reduceRepeats decides a median of exactly one half',
      [
        [[1, 0], 'median', undefined],
        [[1, 0, 1, 0, undefined], 'median', undefined],
        [[1, 1, 0], 'median', 1],
        [[0, 0, 1], 'median', 0],
      ],
      'exactly one half is undecided',
    ),
    reducerCase(
      'at-least-undecided',
      'reduceRepeats fails an at_least that an inconclusive repeat could still reach',
      [
        [[1, 0, undefined], 'at_least:2', undefined],
        [[1, 0, 0], 'at_least:2', 0],
        [[1, 1, undefined], 'at_least:2', 1],
      ],
      'a fail only when the passes plus the inconclusive repeats cannot reach k',
    ),
    rule(
      'at-least-spelling',
      REDUCERS,
      'parseRepeatReducer accepts at_least with k of 0 or a leading zero',
      ({ s }) => {
        const parse = exported(s, 'parseRepeatReducer') as Parse | undefined;
        if (!parse) return fail('@agent-nexus/driftbench-stats exports no parseRepeatReducer');
        for (const spelling of ['at_least:0', 'at_least:03', 'at_least:', 'at_least:-1']) {
          const got = attempt(() => parse(spelling));
          if (!(got.error instanceof RangeError))
            return fail(
              `parseRepeatReducer('${spelling}') ${got.error ? `threw ${got.error.name}` : `returned ${show(got.value)}`}; the spelling is at_least:<k> with k a whole number from 1 written without a leading zero (docs/reference/spec.md, repeat_reducer: ^(mode|median|at_least:[1-9][0-9]*)$): throw a RangeError.`,
            );
        }
        const k = attempt(() => parse('at_least:12'));
        return (k.value as { k?: number } | undefined)?.k === 12
          ? ok()
          : fail(
              `parseRepeatReducer('at_least:12') gave ${show(k.value ?? k.error?.message)}, want { kind: 'at_least', k: 12 }.`,
            );
      },
    ),
  ];
}
