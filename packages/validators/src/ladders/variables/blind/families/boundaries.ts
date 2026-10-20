import type { ItemContext } from '../../bank/item';
import type { FileBoundary } from '../../interface';
import { checkCondition, PATH, readSpans } from '../conditions';
import { defect, validateIssue, validateIssueAt, validateOk, variableOf } from '../files';
import { must, type Stem, show } from '../kit';
import { numeric } from '../spans';

/** Family boundaries: R1, R3 (three samples, roles), R4 (merged samples), the sides of a boundary against its comparison. */

type Cmp = 'lt' | 'le' | 'gt' | 'ge';
const UNDER = 'under_two_days';
const EDGE = 'exactly_two_days';
const OVER = 'more_than_two_days';

function boundaryOf(
  ctx: ItemContext,
  patch: Partial<FileBoundary> & { holds: string; fails: string; edge: string },
) {
  return defect(ctx, ({ store }) => {
    variableOf(store, 2).boundaries = [{ limit: 2, comparison: 'gt', ...patch } as FileBoundary];
  });
}

/** Holds and fails for a comparison in its natural orientation. */
function sides(c: Cmp): { holds: string; fails: string } {
  return c === 'gt' || c === 'ge' ? { holds: OVER, fails: UNDER } : { holds: UNDER, fails: OVER };
}

const strict = (c: Cmp): boolean => c === 'gt' || c === 'lt';

function edgeCase(c: Cmp, which: 'holds' | 'fails' | 'third') {
  return (ctx: ItemContext): void => {
    const s = sides(c);
    const edge = which === 'third' ? EDGE : s[which];
    const b = boundaryOf(ctx, { ...s, edge, comparison: c });
    const wrongSide = strict(c) ? which === 'holds' : which === 'fails';
    if (wrongSide) validateIssue(ctx, b.store, 'VARIABLES_BOUNDARY', 'variables.2.boundaries.0.edge');
    else validateOk(ctx, b.store);
  };
}

const roles =
  (subject: string, text: string, limit: number, c: Cmp, integer = true) =>
  (ctx: ItemContext): void => {
    checkCondition(readSpans(ctx, [numeric(text, subject, limit, c)]), limit, c, integer);
  };

export const BOUNDARIES_STEMS: readonly Stem[] = [
  {
    id: 'boundaries.file.sides',
    rules: ['Boundaries', 'Limits'],
    family: 'boundaries',
    component: 'store/boundaries',
    cause:
      'the loader puts the edge on the side the comparison says: a strict comparison leaves the limit on the failing side, an inclusive one on the holding side',
    cases: [
      ['gt-edge-is-the-holds-value', 2, edgeCase('gt', 'holds')],
      ['gt-edge-is-the-fails-value', 3, edgeCase('gt', 'fails')],
      ['gt-edge-is-a-third-value', 2, edgeCase('gt', 'third')],
      ['lt-edge-is-the-holds-value', 2, edgeCase('lt', 'holds')],
      ['lt-edge-is-the-fails-value', 3, edgeCase('lt', 'fails')],
      ['lt-edge-is-a-third-value', 2, edgeCase('lt', 'third')],
      ['ge-edge-is-the-holds-value', 3, edgeCase('ge', 'holds')],
      ['ge-edge-is-the-fails-value', 2, edgeCase('ge', 'fails')],
      ['ge-edge-is-a-third-value', 2, edgeCase('ge', 'third')],
      ['le-edge-is-the-holds-value', 3, edgeCase('le', 'holds')],
      ['le-edge-is-the-fails-value', 2, edgeCase('le', 'fails')],
      ['le-edge-is-a-third-value', 2, edgeCase('le', 'third')],
      [
        'one-value-on-both-sides',
        2,
        (ctx) => {
          const b = boundaryOf(ctx, { holds: OVER, fails: OVER, edge: EDGE });
          validateIssue(ctx, b.store, 'VARIABLES_BOUNDARY', 'variables.2.boundaries.0.fails');
        },
      ],
      [
        'no-limit-the-edge-is-the-holds-value',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [{ holds: OVER, fails: UNDER, edge: OVER }];
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'no-limit-the-edge-is-a-third-value',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [{ holds: OVER, fails: UNDER, edge: EDGE }];
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'unknown-holds-value',
        2,
        (ctx) => {
          const b = boundaryOf(ctx, { holds: 'no_such_value', fails: UNDER, edge: EDGE });
          validateIssue(ctx, b.store, 'VARIABLES_UNKNOWN_VALUE', 'variables.2.boundaries.0.holds');
        },
      ],
      [
        'unknown-fails-value',
        2,
        (ctx) => {
          const b = boundaryOf(ctx, { holds: OVER, fails: 'no_such_value', edge: EDGE });
          validateIssue(ctx, b.store, 'VARIABLES_UNKNOWN_VALUE', 'variables.2.boundaries.0.fails');
        },
      ],
      [
        'unknown-edge-value',
        2,
        (ctx) => {
          const b = boundaryOf(ctx, { holds: OVER, fails: UNDER, edge: 'no_such_value' });
          validateIssue(ctx, b.store, 'VARIABLES_UNKNOWN_VALUE', 'variables.2.boundaries.0.edge');
        },
      ],
      [
        'limit-without-a-comparison',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [{ holds: OVER, fails: UNDER, edge: EDGE, limit: 2 }];
          });
          const errors = validateIssueAt(ctx, b.store, 'variables.2.boundaries.0');
          must(
            errors.some((e) => e.code === 'SCHEMA_CUSTOM'),
            () => `no SCHEMA_CUSTOM among ${show(errors, 240)}`,
          );
        },
      ],
      [
        'comparison-without-a-limit',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [{ holds: OVER, fails: UNDER, edge: EDGE, comparison: 'gt' }];
          });
          validateIssueAt(ctx, b.store, 'variables.2.boundaries.0');
        },
      ],
      [
        'unit-without-a-limit',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [{ holds: OVER, fails: UNDER, edge: EDGE, unit: 'days' }];
          });
          validateIssueAt(ctx, b.store, 'variables.2.boundaries.0');
        },
      ],
      [
        'negative-limit',
        2,
        (ctx) =>
          validateOk(
            ctx,
            boundaryOf(ctx, { holds: OVER, fails: UNDER, edge: EDGE, limit: -5, comparison: 'gt' }).store,
          ),
      ],
      [
        'zero-limit',
        2,
        (ctx) =>
          validateOk(
            ctx,
            boundaryOf(ctx, { holds: OVER, fails: UNDER, edge: EDGE, limit: 0, comparison: 'ge' }).store,
          ),
      ],
      [
        'decimal-limit',
        2,
        (ctx) =>
          validateOk(
            ctx,
            boundaryOf(ctx, { holds: OVER, fails: UNDER, edge: EDGE, limit: 0.25, comparison: 'lt' }).store,
          ),
      ],
      [
        'limit-is-not-finite-nan',
        3,
        (ctx) => {
          validateIssueAt(
            ctx,
            boundaryOf(ctx, { holds: OVER, fails: UNDER, edge: EDGE, limit: Number.NaN, comparison: 'gt' })
              .store,
            'variables.2.boundaries.0.limit',
          );
        },
      ],
      [
        'limit-is-not-finite-infinity',
        3,
        (ctx) => {
          validateIssueAt(
            ctx,
            boundaryOf(ctx, {
              holds: OVER,
              fails: UNDER,
              edge: EDGE,
              limit: Number.POSITIVE_INFINITY,
              comparison: 'gt',
            }).store,
            'variables.2.boundaries.0.limit',
          );
        },
      ],
      [
        'comparison-outside-the-list',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [
              { holds: OVER, fails: UNDER, edge: EDGE, limit: 2, comparison: 'eq' as unknown as Cmp },
            ];
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_VALUE', 'variables.2.boundaries.0.comparison');
        },
      ],
      [
        'limit-written-as-text',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [
              { holds: OVER, fails: UNDER, edge: EDGE, limit: '2' as unknown as number, comparison: 'gt' },
            ];
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_TYPE', 'variables.2.boundaries.0.limit');
        },
      ],
      [
        'boundary-with-an-unknown-key',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [
              {
                holds: OVER,
                fails: UNDER,
                edge: EDGE,
                limit: 2,
                comparison: 'gt',
                note: 'x',
              } as unknown as FileBoundary,
            ];
          });
          const errors = validateIssueAt(ctx, b.store, 'variables.2.boundaries.0');
          must(
            errors.some((e) => e.code === 'SCHEMA_UNRECOGNIZED_KEYS'),
            () => `no SCHEMA_UNRECOGNIZED_KEYS among ${show(errors, 240)}`,
          );
        },
      ],
      [
        'two-boundaries-on-one-variable',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [
              { holds: OVER, fails: UNDER, edge: EDGE, limit: 2, comparison: 'gt' },
              { holds: UNDER, fails: OVER, edge: EDGE, limit: 5, comparison: 'lt' },
            ];
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'second-boundary-wrong-side-is-reported-at-its-index',
        4,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 2).boundaries = [
              { holds: OVER, fails: UNDER, edge: EDGE, limit: 2, comparison: 'gt' },
              { holds: UNDER, fails: OVER, edge: UNDER, limit: 5, comparison: 'lt' },
            ];
          });
          validateIssue(ctx, b.store, 'VARIABLES_BOUNDARY', 'variables.2.boundaries.1.edge');
        },
      ],
    ],
  },
  {
    id: 'boundaries.reader.roles',
    rules: ['R3', 'R4'],
    family: 'boundaries',
    component: 'store/boundaries',
    cause:
      'a numeric condition yields three samples below, at and above its limit, with holds, fails and edge on the sides its comparison says',
    cases: [
      ['more-than', 2, roles('the delay', 'the delay is more than 2 days', 2, 'gt')],
      ['at-least', 2, roles('the refund', 'the refund is at least 5 euros', 5, 'ge')],
      ['under', 2, roles('the draft', 'the draft is under 120 words', 120, 'lt')],
      ['at-most', 2, roles('the reply', 'the reply holds at most 1 question', 1, 'le')],
      [
        'whole-limit-gives-whole-samples-gt',
        3,
        roles('the queue', 'the queue is more than 7 tickets', 7, 'gt', true),
      ],
      [
        'whole-limit-gives-whole-samples-lt',
        3,
        roles('the queue', 'the queue is under 3 tickets', 3, 'lt', true),
      ],
      ['decimal-limit', 3, roles('the rating', 'the rating is more than 2.5 stars', 2.5, 'gt', false)],
      ['zero-limit', 3, roles('the balance', 'the balance is under 0 euros', 0, 'lt', true)],
      [
        'negative-limit',
        3,
        roles('the temperature', 'the temperature is at most -3 degrees', -3, 'le', true),
      ],
      ['large-limit', 3, roles('the order', 'the order is at least 1000000 euros', 1_000_000, 'ge', true)],
      [
        'edge-is-always-a-third-value',
        3,
        (ctx) => {
          for (const [text, limit, c] of [
            ['the delay is at least 4 days', 4, 'ge'],
            ['the delay is at most 4 days', 4, 'le'],
          ] as const) {
            const r = readSpans(ctx, [numeric(text, 'the delay', limit, c)]);
            const b = r.variable.boundaries?.find((x) => x.limit === limit && x.comparison === c);
            must(
              !!b && new Set([b.holds, b.fails, b.edge]).size === 3,
              () => `for ${c} the boundary is ${show(b)}; a reader always writes a third value for the edge`,
            );
          }
        },
      ],
      [
        'samples-carry-the-span-and-its-file',
        3,
        (ctx) => {
          const text = numeric('the delay is more than 2 days', 'the delay', 2, 'gt');
          const r = readSpans(ctx, [text]);
          for (const s of r.samples) {
            const q = s.value.provenance?.find((p) => p.kind === 'quote');
            must(
              q?.kind === 'quote' && q.path === PATH && q.quote === text,
              () =>
                `sample ${s.sample} has provenance ${show(s.value.provenance)}; expected a quote of the span in ${PATH}`,
            );
          }
        },
      ],
      [
        'two-spans-of-one-quantity-share-samples-without-duplicates',
        4,
        (ctx) => {
          const r = readSpans(ctx, [
            numeric('the delay is more than 2 days', 'the delay', 2, 'gt'),
            numeric('the delay is at least 2 days', 'the delay', 2, 'ge'),
          ]);
          const nums = r.samples.map((s) => s.sample);
          must(new Set(nums).size === nums.length, () => `samples ${show(nums)} repeat a number`);
          must(
            nums.includes(2) && nums.some((n) => n < 2) && nums.some((n) => n > 2),
            () => `samples ${show(nums)} lack a case below, at or above 2`,
          );
          must(
            r.store.variables.filter((v) => v.values.some((x) => typeof x.sample === 'number')).length === 1,
            () => 'two spans of one quantity gave more than one variable',
          );
        },
      ],
      [
        'two-limits-of-one-quantity-keep-all-samples',
        4,
        (ctx) => {
          const r = readSpans(ctx, [
            numeric('the delay is more than 2 days', 'the delay', 2, 'gt'),
            numeric('the delay is more than 6 days', 'the delay', 6, 'gt'),
          ]);
          const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
          for (const limit of [2, 6]) {
            must(
              nums.some((n) => n < limit) && nums.includes(limit) && nums.some((n) => n > limit),
              () => `samples ${show(nums)} lack a case below, at or above ${limit}`,
            );
          }
          must(new Set(nums).size === nums.length, () => `samples ${show(nums)} repeat a number`);
        },
      ],
    ],
  },
];
