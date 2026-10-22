import type { ItemContext } from '../../bank/item';
import type { Row } from '../../interface';
import { baseFile, defect, validateIssue, validateIssueAt, validateOk, variableOf } from '../files';
import { callInterval, must, type Stem, show } from '../kit';
import { conversationsOf, discover, OWNER_DATE, type ToolSpec } from '../scene';

/** Family weights: R5 (counts and owner weights), R9 (relative), R13 (Wilson interval), Values and Limits (the loader). */

const Z = 1.959963984540054;

function wilson(count: number, total: number): [number, number] {
  const p = count / total;
  const d = 1 + (Z * Z) / total;
  const centre = (p + (Z * Z) / (2 * total)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const exact =
  (count: number, total: number) =>
  (ctx: ItemContext): void => {
    const [lo, hi] = callInterval(ctx, count, total);
    const [wl, wh] = wilson(count, total);
    must(
      Math.abs(lo - wl) <= 1e-9 && Math.abs(hi - wh) <= 1e-9,
      () => `weightInterval(${count}, ${total}) = [${lo}, ${hi}]; the Wilson interval is [${wl}, ${wh}]`,
    );
  };

const TOOLS = (): ToolSpec[] => [
  { tool: 'router_tool', field: 'queue', values: ['alpha', 'beta', 'gamma'] },
  { tool: 'mailer_tool', field: 'tone', values: ['warm', 'brisk'] },
];

function sessions(variable: string, plan: Array<[string, number]>, extra = 0): Row[] {
  const rows: Row[] = [];
  for (const [value, n] of plan) for (let i = 0; i < n; i += 1) rows.push({ [variable]: value });
  for (let i = 0; i < extra; i += 1) rows.push({});
  return rows;
}

const weightOf = (
  store: ReturnType<ReturnType<typeof discover>['build']>,
  variable: string,
  value: string,
): number | undefined =>
  store.variables.find((v) => v.id === variable)?.values.find((x) => x.id === value)?.weight;

function setWeights(ctx: ItemContext, weights: Array<number | undefined>) {
  return defect(ctx, ({ store }) => {
    const v = variableOf(store, 2);
    v.values.forEach((x, i) => {
      if (weights[i] === undefined) delete x.weight;
      else x.weight = weights[i];
    });
  });
}

export const WEIGHTS_STEMS: readonly Stem[] = [
  {
    id: 'weights.interval',
    rules: ['R13'],
    family: 'weights',
    component: 'store/weights',
    cause:
      'weightInterval returns the two-sided 95 percent Wilson score interval of count over total, with z = 1.959963984540054, clamped to 0 and 1',
    cases: [
      ['zero-of-one', 2, exact(0, 1)],
      ['one-of-one', 2, exact(1, 1)],
      ['zero-of-ten', 2, exact(0, 10)],
      ['ten-of-ten', 2, exact(10, 10)],
      ['five-of-ten', 1, exact(5, 10)],
      ['three-of-seven', 2, exact(3, 7)],
      ['fifty-of-a-hundred', 1, exact(50, 100)],
      ['one-of-two', 2, exact(1, 2)],
      ['two-of-three', 2, exact(2, 3)],
      ['thirty-three-of-a-hundred', 2, exact(33, 100)],
      ['zero-of-a-hundred', 3, exact(0, 100)],
      ['one-of-a-thousand', 3, exact(1, 1000)],
      ['five-hundred-of-a-thousand', 3, exact(500, 1000)],
      ['one-million-total', 4, exact(999_999, 1_000_000)],
      ['one-billion-total', 5, exact(123_456_789, 1_000_000_000)],
      [
        'totals-beyond-the-square-root-of-the-largest-double',
        5,
        (ctx) => {
          const z2 = Z * Z;
          for (const total of [2 ** 512, 2 ** 600, 2 ** 900]) {
            const [zl, zh] = callInterval(ctx, 0, total);
            const upper = z2 / (total + z2);
            must(
              zl === 0 && Math.abs(zh - upper) <= upper * 1e-9,
              () => `weightInterval(0, 2^${Math.log2(total)}) = [${zl}, ${zh}]; the Wilson interval is [0, ${upper}]`,
            );
            const [hl, hh] = callInterval(ctx, total / 2, total);
            const half = Z * Math.sqrt(0.25 / total);
            must(
              hl < 0.5 && hh > 0.5 && Math.abs((hh - hl) / 2 - half) <= half * 1e-6,
              () => `weightInterval(2^${Math.log2(total) - 1}, 2^${Math.log2(total)}) = [${hl}, ${hh}]; it holds 0.5 with half-width ${half}`,
            );
          }
        },
      ],
      [
        'is-not-the-constant-zero-one',
        1,
        (ctx) => {
          const [lo, hi] = callInterval(ctx, 50, 100);
          must(
            lo > 0.3 && hi < 0.7,
            () => `[${lo}, ${hi}] for 50 of 100; a constant [0, 1] is not this interval`,
          );
        },
      ],
      [
        'inside-zero-one-and-ordered',
        2,
        (ctx) => {
          for (const [c, n] of [
            [0, 3],
            [3, 3],
            [1, 9],
            [8, 9],
            [17, 40],
          ] as const) {
            const [lo, hi] = callInterval(ctx, c, n);
            must(
              lo >= 0 && hi <= 1 && lo <= hi,
              () => `[${lo}, ${hi}] for ${c} of ${n} is not an ordered interval inside [0, 1]`,
            );
          }
        },
      ],
      [
        'contains-the-observed-share',
        2,
        (ctx) => {
          for (const [c, n] of [
            [1, 8],
            [4, 8],
            [7, 8],
            [13, 90],
          ] as const) {
            const [lo, hi] = callInterval(ctx, c, n);
            must(lo <= c / n && c / n <= hi, () => `[${lo}, ${hi}] lacks the observed share ${c / n}`);
          }
        },
      ],
      [
        'is-mirrored-for-the-complement',
        3,
        (ctx) => {
          for (const [c, n] of [
            [2, 9],
            [11, 40],
            [1, 100],
          ] as const) {
            const [lo, hi] = callInterval(ctx, c, n);
            const [lo2, hi2] = callInterval(ctx, n - c, n);
            must(
              Math.abs(lo - (1 - hi2)) <= 1e-9 && Math.abs(hi - (1 - lo2)) <= 1e-9,
              () => `the interval of ${c} of ${n} is not the mirror of ${n - c} of ${n}`,
            );
          }
        },
      ],
      [
        'narrows-as-the-total-grows',
        3,
        (ctx) => {
          const width = (c: number, n: number): number => {
            const [lo, hi] = callInterval(ctx, c, n);
            return hi - lo;
          };
          must(
            width(5, 10) > width(50, 100) && width(50, 100) > width(500, 1000),
            () => 'the interval does not narrow when the same share is seen in more sessions',
          );
        },
      ],
      [
        'zero-count-starts-at-zero-and-full-count-ends-at-one',
        3,
        (ctx) => {
          const [lo] = callInterval(ctx, 0, 25);
          const [, hi] = callInterval(ctx, 25, 25);
          must(
            Math.abs(lo) <= 1e-12 && Math.abs(hi - 1) <= 1e-12,
            () => `lower of 0 of 25 is ${lo}, upper of 25 of 25 is ${hi}`,
          );
        },
      ],
      [
        'stays-inside-zero-one-despite-rounding',
        4,
        (ctx) => {
          // The formula of the page, evaluated as written, leaves [0, 1] by a rounding error for some counts
          // (0 of 21, 16 of 16, 40 of 40, ...). The interval is clamped to [0, 1].
          for (let n = 1; n <= 300; n += 1) {
            for (const c of [0, n]) {
              const [lo, hi] = callInterval(ctx, c, n);
              must(lo >= 0 && hi <= 1, () => `[${lo}, ${hi}] for ${c} of ${n} leaves [0, 1]`);
            }
          }
        },
      ],
      [
        'contains-the-true-share-about-95-percent-of-the-time',
        4,
        (ctx) => {
          const p = 0.3;
          const n = 60;
          const trials = 3000;
          let hit = 0;
          for (let t = 0; t < trials; t += 1) {
            let c = 0;
            for (let i = 0; i < n; i += 1) if (ctx.rng.next() < p) c += 1;
            const [lo, hi] = callInterval(ctx, c, n);
            if (lo <= p && p <= hi) hit += 1;
          }
          const cover = hit / trials;
          must(
            cover >= 0.92 && cover <= 0.985,
            () =>
              `the interval holds the true share in ${cover} of ${trials} draws; a 95 percent interval does so about 95 percent of the time`,
          );
        },
      ],
    ],
  },
  {
    id: 'weights.file',
    rules: ['Values', 'Limits'],
    family: 'weights',
    component: 'store/validate',
    cause:
      'the loader refuses partial and all-zero weights and bad numbers, and accepts relative weights on any scale',
    cases: [
      ['percent-weights-are-valid', 1, (ctx) => validateOk(ctx, setWeights(ctx, [60, 15, 25]).store)],
      ['fraction-weights-are-valid', 1, (ctx) => validateOk(ctx, setWeights(ctx, [0.6, 0.15, 0.25]).store)],
      ['no-weights-are-valid', 1, (ctx) => validateOk(ctx, baseFile(ctx).store)],
      ['one-zero-among-others-is-valid', 3, (ctx) => validateOk(ctx, setWeights(ctx, [0, 5, 5]).store)],
      [
        'weight-on-two-values-only',
        2,
        (ctx) =>
          validateIssue(
            ctx,
            setWeights(ctx, [0.5, undefined, 0.5]).store,
            'VARIABLES_WEIGHT_INCOMPLETE',
            'variables.2.values.1.weight',
          ),
      ],
      [
        'weight-on-the-first-value-only',
        2,
        (ctx) =>
          validateIssue(
            ctx,
            setWeights(ctx, [1, undefined, undefined]).store,
            'VARIABLES_WEIGHT_INCOMPLETE',
            'variables.2.values.1.weight',
          ),
      ],
      [
        'weight-on-the-last-value-only',
        3,
        (ctx) =>
          validateIssue(
            ctx,
            setWeights(ctx, [undefined, undefined, 1]).store,
            'VARIABLES_WEIGHT_INCOMPLETE',
            'variables.2.values.0.weight',
          ),
      ],
      [
        'every-weight-zero',
        2,
        (ctx) =>
          validateIssue(ctx, setWeights(ctx, [0, 0, 0]).store, 'VARIABLES_WEIGHT_ZERO', 'variables.2.values'),
      ],
      [
        'negative-weight',
        2,
        (ctx) =>
          validateIssue(
            ctx,
            setWeights(ctx, [1, -1, 1]).store,
            'SCHEMA_TOO_SMALL',
            'variables.2.values.1.weight',
          ),
      ],
      [
        'weight-written-as-text',
        2,
        (ctx) => {
          const b = setWeights(ctx, [1, 1, 1]);
          (variableOf(b.store, 2).values[1] as unknown as { weight: string }).weight = 'a lot';
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_TYPE', 'variables.2.values.1.weight');
        },
      ],
      [
        'weight-not-a-number',
        3,
        (ctx) =>
          validateIssueAt(ctx, setWeights(ctx, [1, Number.NaN, 1]).store, 'variables.2.values.1.weight'),
      ],
      [
        'weight-infinite',
        3,
        (ctx) =>
          validateIssueAt(
            ctx,
            setWeights(ctx, [1, Number.POSITIVE_INFINITY, 1]).store,
            'variables.2.values.1.weight',
          ),
      ],
      [
        'incomplete-weights-in-the-second-variable',
        3,
        (ctx) => {
          const b = baseFile(ctx);
          for (const x of variableOf(b.store, 0).values) x.weight = 1;
          const second = variableOf(b.store, 1);
          (second.values[0] as { weight?: number }).weight = 2;
          validateIssue(ctx, b.store, 'VARIABLES_WEIGHT_INCOMPLETE', 'variables.1.values.1.weight');
        },
      ],
      [
        'complete-weights-in-two-variables',
        2,
        (ctx) => {
          const b = baseFile(ctx);
          for (const x of variableOf(b.store, 0).values) x.weight = 3;
          for (const x of variableOf(b.store, 1).values) x.weight = 0.2;
          validateOk(ctx, b.store);
        },
      ],
    ],
  },
  {
    id: 'weights.reader',
    rules: ['R5'],
    family: 'weights',
    component: 'store/conversations',
    cause:
      'weights from conversations are relative counts of the observed variables only, and owner weights are stored as declared or refused with a reason',
    cases: [
      [
        'conversation-weights-are-proportional-to-counts',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                ['alpha', 6],
                ['beta', 3],
                ['gamma', 1],
              ]),
            ),
          });
          const [a, b, c] = ['alpha', 'beta', 'gamma'].map((v) => weightOf(store, id, v)) as [
            number,
            number,
            number,
          ];
          must(
            typeof a === 'number' && typeof b === 'number' && typeof c === 'number',
            () => `weights ${show([a, b, c])}; an observed variable has a weight on every value`,
          );
          must(
            Math.abs(a / b - 2) < 1e-9 && Math.abs(b / c - 3) < 1e-9,
            () => `weights ${a}, ${b}, ${c} are not in the ratio of the counts 6, 3, 1`,
          );
        },
      ],
      [
        'an-unobserved-variable-gains-no-weights',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const [id, other] = d.ids as [string, string];
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                ['alpha', 4],
                ['beta', 4],
              ]),
            ),
          });
          const v = store.variables.find((x) => x.id === other);
          must(
            v?.values.every((x) => x.weight === undefined),
            () => `the unobserved variable got weights ${show(v?.values.map((x) => x.weight))}`,
          );
        },
      ],
      [
        'empty-conversations-change-no-weight',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const store = d.build({ conversations: [] });
          must(
            store.variables.every((v) => v.values.every((x) => x.weight === undefined)),
            () => 'empty conversation input added weights',
          );
          must(
            JSON.stringify(store) === JSON.stringify(d.store),
            () => 'empty conversation input changed the store',
          );
        },
      ],
      [
        'sessions-that-miss-the-variable-do-not-raise-its-total',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(
                id,
                [
                  ['alpha', 3],
                  ['beta', 1],
                ],
                6,
              ),
            ),
          });
          const entry = store.variables
            .find((v) => v.id === id)
            ?.values.find((x) => x.id === 'alpha')
            ?.provenance?.find((p) => p.kind === 'conversations');
          must(
            entry?.kind === 'conversations' && entry.count === 3 && entry.total === 4,
            () => `provenance ${show(entry)}; 3 of the 4 sessions that show the variable, not of 10`,
          );
        },
      ],
      [
        'an-unknown-value-is-a-weighted-unapproved-proposal',
        4,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                ['alpha', 5],
                ['beta', 3],
                ['newcomer', 2],
              ]),
            ),
          });
          const v = store.variables.find((x) => x.id === id)?.values.find((x) => x.id === 'newcomer');
          must(
            !!v && v.approved === false,
            () => `newcomer is ${show(v)}; a value seen but unknown is an unapproved proposal`,
          );
          const [a, n] = [weightOf(store, id, 'alpha'), weightOf(store, id, 'newcomer')] as [number, number];
          must(
            typeof a === 'number' && typeof n === 'number' && Math.abs(a / n - 2.5) < 1e-9,
            () => `weights ${a} and ${n} are not in the ratio of the counts 5 and 2`,
          );
        },
      ],
      [
        'owner-weights-are-stored-as-declared',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const w = (value: string, weight: number) => ({
            variable: id,
            value,
            weight,
            words: `Traffic is mostly ${value}.`,
            date: OWNER_DATE,
          });
          const store = d.build({ owner: { weights: [w('alpha', 60), w('beta', 30), w('gamma', 10)] } });
          must(
            weightOf(store, id, 'alpha') === 60 &&
              weightOf(store, id, 'beta') === 30 &&
              weightOf(store, id, 'gamma') === 10,
            () =>
              `stored weights ${show(['alpha', 'beta', 'gamma'].map((v) => weightOf(store, id, v)))}; expected 60, 30, 10 as declared`,
          );
        },
      ],
      [
        'owner-negative-weight-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            owner: {
              weights: [{ variable: id, value: 'alpha', weight: -2, words: 'Minus two.', date: OWNER_DATE }],
            },
          });
          must(weightOf(store, id, 'alpha') === undefined, () => 'a negative owner weight entered the store');
          must(
            store.refused.length >= 1 &&
              store.refused.every((r) => r.reason.length >= 8 && r.reason !== r.what),
            () => `refusals ${show(store.refused)}`,
          );
        },
      ],
      [
        'owner-weight-that-is-not-finite-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          for (const weight of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            const store = d.build({
              owner: {
                weights: [{ variable: id, value: 'beta', weight, words: 'Not a number.', date: OWNER_DATE }],
              },
            });
            must(
              weightOf(store, id, 'beta') === undefined,
              () => `the owner weight ${weight} entered the store`,
            );
            must(store.refused.length >= 1, () => `no refusal for the owner weight ${weight}`);
          }
        },
      ],
      [
        'owner-weight-for-a-missing-value-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            owner: {
              weights: [
                { variable: id, value: 'no_such_value', weight: 3, words: 'Three.', date: OWNER_DATE },
              ],
            },
          });
          must(
            !store.variables.find((v) => v.id === id)?.values.some((x) => x.id === 'no_such_value'),
            () => 'a weight for a missing value created the value',
          );
          must(store.refused.length >= 1, () => 'no refusal for a weight on a missing value');
        },
      ],
    ],
  },
];
