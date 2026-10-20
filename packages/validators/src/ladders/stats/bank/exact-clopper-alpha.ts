import { call, exactItem, SRC } from './exact';
import type { BankItem } from './item';

/**
 * The exact (Clopper-Pearson) interval must keep alpha / 2 as a log tail when the probability underflows.
 * References come from make_exact_clopper_alpha.py: bisection on the exact binomial tails at 160 digits at the
 * exact double alpha, with no beta function and no call of the product. The groups are Number.MIN_VALUE (alpha / 2
 * rounds to 0), the subnormal range (alpha / 2 loses bits) and the smallest normal range; the lower and the upper
 * limit are separate items. All six share one mechanism, hence one cause.
 */
const FILE = 'packages/validators/fixtures/stats/exact-clopper-alpha.json';
const CAUSE =
  'clopperPearson halves alpha before the beta quantile, so alpha / 2 underflows or loses bits instead of the beta tail being taken in log space';
/** A limit that is a subnormal double has fewer than 52 bits: two steps of the grid are the same number. */
const TOL = { rel: 1e-10, abs: 2 * Number.MIN_VALUE };

export function clopperAlphaItems(): BankItem[] {
  return ['alpha-min', 'alpha-subnormal', 'alpha-small-normal'].flatMap((range) =>
    (['lower', 'upper'] as const).map((side) =>
      exactItem({
        fn: 'clopperPearson',
        aspect: `${range}-${side}`,
        group: `clopperPearson.${range}`,
        file: FILE,
        family: 'exact-estimators',
        tier: 4,
        component: `${SRC}/intervals.ts`,
        cause: CAUSE,
        tol: TOL,
        fields: [side],
        call: (s, c) => {
          const interval = call(s, 'clopperPearson', c.k, c.n, c.alpha) as Record<string, number>;
          return { [side]: interval[side] };
        },
      }),
    ),
  );
}
