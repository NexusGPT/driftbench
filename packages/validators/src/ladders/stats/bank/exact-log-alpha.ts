import { call, exactItem, type Row, type Spec, SRC } from './exact';
import type { BankItem } from './item';

/**
 * Two-sided confidence levels must retain log(alpha) - log(2) when alpha / 2 underflows. References come
 * from make_exact_log_alpha.py: 100-digit log-erfc inversion and the documented interval/power formulas,
 * without calling the product. These twelve cases share one quantile mechanism, hence one cause.
 */
const FILE = 'packages/validators/fixtures/stats/exact-log-alpha.json';
const CAUSE = 'the two-sided normal quantile loses alpha / 2 to underflow instead of retaining its log tail';

function labels(table: number[][]): [number[], number[]] {
  const a: number[] = [];
  const b: number[] = [];
  table.forEach((row, i) => {
    row.forEach((count, j) => {
      for (let n = 0; n < count; n += 1) {
        a.push(i);
        b.push(j);
      }
    });
  });
  return [a, b];
}

type Definition = { fn: string; file: string; run: Spec['call'] };
const DEFINITIONS: Definition[] = [
  { fn: 'zFor', file: 'intervals.ts', run: (s, c) => call(s, 'zFor', c.alpha) },
  {
    fn: 'sampleSizeForEffect',
    file: 'power.ts',
    run: (s, c) => {
      const result = call(s, 'sampleSizeForEffect', {
        effect: c.effect,
        baselineRate: c.baselineRate,
        power: c.power,
        alpha: c.alpha,
      }) as { n: number };
      if (!Number.isInteger(result.n) || result.n < 1)
        throw new Error('sampleSizeForEffect must return a positive integer n');
      return result;
    },
  },
  {
    fn: 'mde',
    file: 'power.ts',
    run: (s, c) =>
      call(s, 'mde', {
        n: c.n,
        baselineRate: c.baselineRate,
        power: c.power,
        alpha: c.alpha,
      }),
  },
  {
    fn: 'wilsonEffective',
    file: 'effective.ts',
    run: (s, c) => call(s, 'wilsonEffective', c.clusters, { alpha: c.alpha, quantile: 'z' }),
  },
  {
    fn: 'pairedRateDifference',
    file: 'paired.ts',
    run: (s, c) => call(s, 'pairedRateDifference', c.table, c.alpha),
  },
  {
    fn: 'kappaInterval',
    file: 'agreement.ts',
    run: (s, c: Row) => {
      const [a, b] = labels(c.table);
      return call(s, 'kappaInterval', a, b, { alpha: c.alpha });
    },
  },
];

export function logAlphaItems(): BankItem[] {
  return DEFINITIONS.flatMap(({ fn, file, run }) =>
    ['log-alpha-min', 'log-alpha-small-normal'].map((aspect) =>
      exactItem({
        fn,
        aspect,
        group: `${fn}.${aspect}`,
        file: FILE,
        family: 'exact-estimators',
        tier: 4,
        component: `${SRC}/${file}`,
        cause: CAUSE,
        tol: (path) => (path === 'n' ? { rel: 0, abs: 0 } : { rel: 1e-10, abs: 1e-12 }),
        call: run,
      }),
    ),
  );
}
