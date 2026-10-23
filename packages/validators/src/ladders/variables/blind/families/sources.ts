import { check, none } from '../../../../failure';
import type { ItemContext } from '../../bank/item';
import { clone } from '../../bank/util';
import type { FileProvenance, Row } from '../../interface';
import { drawnCase, PATH, readSpans } from '../conditions';
import {
  drawBoolean,
  drawBooleanPair,
  drawChoice,
  drawCondition,
  drawEquality,
  drawMembership,
  drawRange,
  policyFile,
  type RangeStyle,
} from '../draws';
import { baseFile, defect, errorsOf, validateIssue, validateIssueAt, validateOk, variableOf } from '../files';
import { callBuild, callValidate, type Stem, show } from '../kit';
import { lex } from '../lexicon';
import {
  conversationsOf,
  discover,
  estateFor,
  OWNER_DATE,
  pairOf,
  quoteFor,
  type ToolSpec,
  varOf,
} from '../scene';
import { type Cmp, declareSpan, numeric } from '../spans';

/** Family sources: R1 (provenance of every value), R3 (conditions), R4 (identity and merging), R5 (conversations, owner). */

const ENTRY = 'variables.2.values.0.provenance.0';
const HASH = 'ab'.repeat(32);

/** The base store with one provenance entry on the first value of the detail. */
function withEntry(ctx: ItemContext, entry: unknown) {
  return defect(ctx, ({ store }) => {
    (variableOf(store, 2).values[0] as { provenance?: unknown[] }).provenance = [entry];
  }).store;
}

const refused =
  (entry: unknown, code: string, path?: string) =>
  (ctx: ItemContext): void => {
    validateIssue(ctx, withEntry(ctx, entry), code, path === undefined ? undefined : `${ENTRY}.${path}`);
  };

/** The store is refused at the entry or below it with this code. */
const refusedBelow =
  (entry: unknown, code: string) =>
  (ctx: ItemContext): void => {
    const errors = validateIssueAt(ctx, withEntry(ctx, entry), ENTRY);
    check(
      errors.some((e) => e.code === code),
      () => ({
        rule: 'no {} among {}',
        got: { details: [code, show(errors, 240)] },
        expected: none('observation'),
      }),
    );
  };

const accepted =
  (entry: unknown) =>
  (ctx: ItemContext): void => {
    validateOk(ctx, withEntry(ctx, entry), `a store with the entry ${show(entry, 120)}`);
  };

const quoteEntry = (extra: Record<string, unknown> = {}): FileProvenance =>
  ({ kind: 'quote', path: 'agent/prompt.md', quote: 'Offer a supplier email.', ...extra }) as FileProvenance;
const convEntry = (extra: Record<string, unknown> = {}): FileProvenance =>
  ({ kind: 'conversations', count: 3, total: 10, set_hash: HASH, ...extra }) as FileProvenance;
const ownerEntry = (extra: Record<string, unknown> = {}): FileProvenance =>
  ({ kind: 'owner', words: 'We see this on Mondays.', date: '2026-10-17', ...extra }) as FileProvenance;
const structEntry = (extra: Record<string, unknown> = {}) => ({
  kind: 'structure',
  path: 'settings.json',
  pointer: '/permissions/deny/0',
  hash: HASH,
  ...extra,
});

const rangeCase =
  (style?: RangeStyle) =>
  (ctx: ItemContext): void => {
    const d = drawRange(ctx.rng, style);
    const r = readSpans(ctx, [
      declareSpan(d.text, { kind: 'range', subject: d.subject, lo: d.lo, hi: d.hi }),
    ]);
    const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
    check(new Set(nums).size === nums.length, () => ({
      rule: 'samples {} repeat a number',
      got: { details: [show(nums)] },
      expected: none('observation'),
    }));
    check(
      nums.some((n) => n < d.lo) &&
        nums.includes(d.lo) &&
        nums.some((n) => n > d.lo && n < d.hi) &&
        nums.includes(d.hi) &&
        nums.some((n) => n > d.hi),
      () => ({
        rule: 'samples {} lack one of: below {}, at {}, strictly inside, at {}, above {}',
        got: { details: [show(nums), d.lo, d.lo, d.hi, d.hi] },
        expected: none('observation'),
      }),
    );
  };

const choiceCase =
  (kind: 'neither' | 'either') =>
  (ctx: ItemContext): void => {
    const d = drawChoice(ctx.rng, kind);
    const text = declareSpan(d.text, { kind: 'member', subject: d.subject, list: d.list });
    const store = callBuild(ctx, {
      estate: {
        files: { [PATH]: policyFile(ctx.rng, [text]) },
        rules: [{ id: 'rule.choice', source: PATH, conditions: [{ text }], tools: [] }],
      },
    });
    const v = store.variables.find((x) => x.values.some((y) => typeof y.sample === 'string'));
    check(!!v, () => ({
      rule: 'no variable with string samples for {}',
      got: { details: [show(d.text)] },
      expected: none('observation'),
    }));
    const samples = (v?.values ?? []).map((y) => String(y.sample));
    check(
      samples.some((s) => d.list.includes(s)),
      () => ({
        rule: 'samples {} lack a member of {}',
        got: { details: [show(samples), show(d.list)] },
        expected: none('observation'),
      }),
    );
    check(
      samples.some((s) => !d.list.includes(s)),
      () => ({
        rule: 'samples {} lack a value outside {}',
        got: { details: [show(samples), show(d.list)] },
        expected: none('observation'),
      }),
    );
    check((v?.boundaries ?? []).length === 0, () => ({
      rule: 'a membership condition has no numeric boundary',
      expected: none('observation'),
    }));
  };

const TOOLS = (): ToolSpec[] => [
  { tool: lex('router_tool'), field: lex('queue'), values: [lex('alpha'), lex('beta'), lex('gamma')] },
  { tool: lex('mailer_tool'), field: lex('tone'), values: [lex('warm'), lex('brisk')] },
];

function sessions(variable: string, plan: Array<[string, number]>, extra = 0): Row[] {
  const rows: Row[] = [];
  for (const [value, n] of plan) for (let i = 0; i < n; i += 1) rows.push({ [variable]: value });
  for (let i = 0; i < extra; i += 1) rows.push({});
  return rows;
}

const convOf = (store: ReturnType<typeof callBuild>, variable: string, value: string) =>
  store.variables
    .find((v) => v.id === variable)
    ?.values.find((x) => x.id === value)
    ?.provenance?.find((p) => p.kind === 'conversations');

function hashes(store: ReturnType<typeof callBuild>, variable: string): string[] {
  const out: string[] = [];
  for (const value of store.variables.find((v) => v.id === variable)?.values ?? []) {
    const e = value.provenance?.find((p) => p.kind === 'conversations');
    if (e?.kind === 'conversations') out.push(e.set_hash);
  }
  return out;
}

type Labelled = { text: string; label: Record<string, unknown> };

/** Builds a store from condition spans that carry a label, each in the file its rule names. */
function readLabelled(ctx: ItemContext, conditions: readonly Labelled[]) {
  const file = 'agent/prompt.md';
  const sources = {
    estate: {
      files: { [file]: conditions.map((c) => `Escalate when ${c.text}.`).join('\n') },
      rules: conditions.map((c, i) => ({ id: `rule.${i}`, source: file, conditions: [c], tools: [] })),
    },
  } as unknown as Parameters<typeof callBuild>[1];
  return callBuild(ctx, sources);
}

const samplesOf = (store: ReturnType<typeof callBuild>): Array<number | string | boolean | undefined> =>
  store.variables.flatMap((v) => v.values.map((x) => x.sample));

/**
 * A condition span the validator labelled: the product follows the label, not its own reading of the text. A product that
 * carries a table of the span vocabulary (or a pattern for it) and labels the spans itself reads the text, and the label
 * here disagrees with the text on purpose, so it builds another limit than the label gives. One item for each kind of span
 * (a numeric comparison, a range, a membership list, a true-or-false fact): a product that follows the label for the one
 * kind the first item tries and reads its own table for the others passes that item and none of these.
 */
const LABELLED_STEM: Stem = {
  id: 'sources.labelled-condition',
  rules: ['R3'],
  family: 'sources',
  component: 'store/estate',
  cause:
    'buildStore builds a condition from the label the reader gave the span and reads nothing else of its text',
  cases: [
    [
      'the-label-decides-not-the-text',
      4,
      (ctx) => {
        const text = 'the delay is more than 5 days';
        const label = { kind: 'numeric', subject: 'the delay', limit: 9, comparison: 'gt' };
        const sources = {
          estate: {
            files: { 'agent/prompt.md': `Escalate when ${text}.` },
            rules: [
              {
                id: 'rule.delay',
                source: 'agent/prompt.md',
                conditions: [{ text, label }],
                tools: [],
              },
            ],
          },
        } as unknown as Parameters<typeof callBuild>[1];
        const store = callBuild(ctx, sources);
        const read = store.variables.map((v) => v.values.map((x) => x.sample));
        const hit = read.find((samples) => [8, 9, 10].every((n) => samples.includes(n)));
        check(hit !== undefined, () => ({
          rule: 'a condition with a label reads the limit of the label, not the number in the text',
          got: { read: show(read, 160) },
          expected: none('observation'),
        }));
        check(!read.some((samples) => samples.includes(5)), () => ({
          rule: 'no variable takes the number in the text as its limit when a label gives the limit',
          got: { read: show(read, 160) },
          expected: none('observation'),
        }));
      },
    ],
    [
      'the-label-comparison-decides-not-the-wording',
      4,
      (ctx) => {
        // The wording says "more than"; the label says the quantity must not pass its limit.
        const label = { kind: 'numeric', subject: 'the load', limit: 5, comparison: 'le' };
        const store = readLabelled(ctx, [{ text: 'the load is more than 5 tons', label }]);
        const boundaries = store.variables.flatMap((v) => v.boundaries ?? []);
        check(
          boundaries.some((b) => b.limit === 5 && b.comparison === 'le'),
          () => ({
            rule: 'a condition with a label reads the comparison of the label, not the one its wording states',
            got: { boundaries: show(boundaries, 160) },
            expected: { comparison: 'le' },
          }),
        );
        check(!boundaries.some((b) => b.comparison === 'gt'), () => ({
          rule: 'no boundary takes the comparison of the wording when a label gives the comparison',
          got: { boundaries: show(boundaries, 160) },
          expected: { comparison: 'le' },
        }));
      },
    ],
    [
      'the-label-decides-a-range',
      4,
      (ctx) => {
        // The wording gives the limits 2 and 6; the label gives 100 and 140.
        const label = {
          kind: 'range',
          subject: 'the stay',
          low: 100,
          high: 140,
          lowInclusive: true,
          highInclusive: true,
        };
        const store = readLabelled(ctx, [{ text: 'the stay is between 2 and 6 nights', label }]);
        const nums = samplesOf(store)
          .filter((s): s is number => typeof s === 'number')
          .sort((a, b) => a - b);
        check(
          nums.includes(100) &&
            nums.includes(140) &&
            nums.some((n) => n < 100) &&
            nums.some((n) => n > 100 && n < 140) &&
            nums.some((n) => n > 140),
          () => ({
            rule: 'a range condition with a label gets the samples the page lists for the limits of the label',
            got: { samples: nums },
            expected: { limits: [100, 140] },
          }),
        );
        check(!nums.includes(2) && !nums.includes(6), () => ({
          rule: 'no sample takes a number of the wording when a label gives the limits of the range',
          got: { samples: nums },
          expected: { limits: [100, 140] },
        }));
      },
    ],
    [
      'the-label-decides-a-membership',
      4,
      (ctx) => {
        // The wording lists north, south and east; the label lists three other members.
        const members = ['kazu', 'lemi', 'vora'];
        const label = { kind: 'member', subject: 'the region', members };
        const store = readLabelled(ctx, [{ text: 'the region is one of north, south or east', label }]);
        const samples = samplesOf(store).filter((s): s is string => typeof s === 'string');
        check(samples.some((s) => members.includes(s)) && samples.some((s) => !members.includes(s)), () => ({
          rule: 'a membership condition with a label gets an in-list and an out-of-list sample for the members of the label',
          got: { samples: show(samples, 160) },
          expected: { members },
        }));
        check(!samples.some((s) => ['north', 'south', 'east'].includes(s)), () => ({
          rule: 'no sample takes a word of the wording when a label gives the members',
          got: { samples: show(samples, 160) },
          expected: { members },
        }));
      },
    ],
    [
      'the-label-decides-a-boolean-subject',
      4,
      (ctx) => {
        // The wordings name a parcel and an invoice; the labels give both one subject, so they are one fact.
        const label = { kind: 'boolean', subject: 'the handling flag' };
        const store = readLabelled(ctx, [
          { text: 'the parcel is fragile', label },
          { text: 'the invoice is overdue', label },
        ]);
        const flags = store.variables.filter(
          (v) => v.values.some((x) => x.sample === true) && v.values.some((x) => x.sample === false),
        );
        check(flags.length === 1, () => ({
          rule: 'spans whose labels give one subject are one true-or-false variable, whatever their wording',
          got: { flagVariables: flags.length },
          expected: { flagVariables: 1 },
        }));
        check(flags[0]?.values.length === 2, () => ({
          rule: 'a true-or-false variable holds a true value and a false value',
          got: { values: flags[0]?.values.length },
          expected: { values: 2 },
        }));
      },
    ],
  ],
};

export const SOURCES_STEMS: readonly Stem[] = [
  LABELLED_STEM,
  {
    id: 'sources.file.provenance-shape',
    rules: ['Provenance', 'Limits'],
    family: 'sources',
    component: 'store/validate',
    cause:
      'the loader checks the shape of every provenance entry: quote, structure, conversations and owner, with the limits of the page',
    cases: [
      [
        'a-valid-entry-of-each-kind',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            const v = variableOf(store, 2);
            (v.values[0] as { provenance?: unknown[] }).provenance = [
              quoteEntry({ ledger: 'abcdefghij' }),
              convEntry(),
              ownerEntry(),
              structEntry(),
              structEntry({ pointer: undefined, lines: { start: 2, end: 3 } }),
            ];
          });
          validateOk(ctx, b.store);
        },
      ],
      ['conversation-count-equal-to-total', 2, accepted(convEntry({ count: 10, total: 10 }))],
      ['conversation-count-zero', 2, accepted(convEntry({ count: 0, total: 1 }))],
      ['quote-of-exactly-a-thousand-characters', 2, accepted(quoteEntry({ quote: 'q'.repeat(1000) }))],
      ['owner-words-of-exactly-a-thousand-characters', 3, accepted(ownerEntry({ words: 'w'.repeat(1000) }))],
      ['owner-date-on-a-leap-day', 3, accepted(ownerEntry({ date: '2028-02-29' }))],
      [
        'conversation-count-above-total',
        2,
        refusedBelow(convEntry({ count: 11, total: 10 }), 'SCHEMA_CUSTOM'),
      ],
      [
        'conversation-count-fractional',
        2,
        refused(convEntry({ count: 2.5 }), 'SCHEMA_INVALID_TYPE', 'count'),
      ],
      ['conversation-count-negative', 3, refused(convEntry({ count: -1 }), 'SCHEMA_TOO_SMALL', 'count')],
      ['conversation-total-zero', 2, refused(convEntry({ count: 0, total: 0 }), 'SCHEMA_TOO_SMALL', 'total')],
      [
        'conversation-entry-with-a-text-key',
        2,
        refusedBelow(convEntry({ text: 'hello' }), 'SCHEMA_UNRECOGNIZED_KEYS'),
      ],
      [
        'conversation-hash-in-capitals',
        2,
        refused(convEntry({ set_hash: HASH.toUpperCase() }), 'SCHEMA_INVALID_FORMAT', 'set_hash'),
      ],
      [
        'conversation-hash-one-character-short',
        2,
        refused(convEntry({ set_hash: HASH.slice(1) }), 'SCHEMA_INVALID_FORMAT', 'set_hash'),
      ],
      [
        'owner-date-that-does-not-exist',
        2,
        refused(ownerEntry({ date: '2026-02-30' }), 'SCHEMA_INVALID_FORMAT', 'date'),
      ],
      [
        'owner-date-with-a-time',
        3,
        refused(ownerEntry({ date: '2026-10-17T09:00:00Z' }), 'SCHEMA_INVALID_FORMAT', 'date'),
      ],
      ['owner-words-blank', 2, refusedBelow(ownerEntry({ words: '  \t ' }), 'SCHEMA_CUSTOM')],
      [
        'owner-words-over-a-thousand-characters',
        3,
        refused(ownerEntry({ words: 'w'.repeat(1001) }), 'SCHEMA_TOO_BIG', 'words'),
      ],
      ['quote-blank', 2, refusedBelow(quoteEntry({ quote: '   ' }), 'SCHEMA_CUSTOM')],
      [
        'quote-empty',
        1,
        (ctx) => {
          // An empty quote is also blank, so the loader may name it too small or custom.
          const errors = validateIssueAt(ctx, withEntry(ctx, quoteEntry({ quote: '' })), `${ENTRY}.quote`);
          check(
            errors.some(
              (e) => e.path === `${ENTRY}.quote` && ['SCHEMA_TOO_SMALL', 'SCHEMA_CUSTOM'].includes(e.code),
            ),
            () => ({
              rule: 'no SCHEMA_TOO_SMALL or SCHEMA_CUSTOM at {}.quote among {}',
              got: { details: [ENTRY, show(errors, 240)] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'quote-over-a-thousand-characters',
        3,
        refused(quoteEntry({ quote: 'q'.repeat(1001) }), 'SCHEMA_TOO_BIG', 'quote'),
      ],
      [
        'ledger-id-in-capitals',
        3,
        refused(quoteEntry({ ledger: 'ABCDEFGHIJ' }), 'SCHEMA_INVALID_FORMAT', 'ledger'),
      ],
      [
        'ledger-id-one-character-short',
        3,
        refused(quoteEntry({ ledger: 'abcdefghi' }), 'SCHEMA_INVALID_FORMAT', 'ledger'),
      ],
      [
        'ledger-id-with-a-digit-outside-two-to-seven',
        3,
        refused(quoteEntry({ ledger: 'abcdefgh01' }), 'SCHEMA_INVALID_FORMAT', 'ledger'),
      ],
      ['quote-path-from-the-root', 2, refusedBelow(quoteEntry({ path: '/etc/prompt.md' }), 'SCHEMA_CUSTOM')],
      [
        'quote-path-from-the-home-folder',
        3,
        refusedBelow(quoteEntry({ path: '~/prompt.md' }), 'SCHEMA_CUSTOM'),
      ],
      [
        'quote-path-with-a-backslash',
        3,
        refusedBelow(quoteEntry({ path: 'agent\\prompt.md' }), 'SCHEMA_CUSTOM'),
      ],
      ['quote-path-with-a-scheme', 3, refusedBelow(quoteEntry({ path: 'file:prompt.md' }), 'SCHEMA_CUSTOM')],
      [
        'quote-path-with-a-drive-letter',
        3,
        refusedBelow(quoteEntry({ path: 'C:prompt.md' }), 'SCHEMA_CUSTOM'),
      ],
      ['entry-of-an-unknown-kind', 2, refused({ kind: 'rumour', words: 'x' }, 'SCHEMA_INVALID_UNION')],
      [
        'structure-hash-not-hexadecimal',
        3,
        refused(structEntry({ hash: 'z'.repeat(64) }), 'SCHEMA_INVALID_FORMAT', 'hash'),
      ],
      [
        'structure-with-a-pointer-and-lines',
        3,
        refusedBelow(structEntry({ lines: { start: 1, end: 2 } }), 'SCHEMA_CUSTOM'),
      ],
      [
        'structure-with-neither-pointer-nor-lines',
        3,
        refusedBelow(structEntry({ pointer: undefined }), 'SCHEMA_CUSTOM'),
      ],
      [
        'structure-lines-ending-before-they-start',
        4,
        refusedBelow(structEntry({ pointer: undefined, lines: { start: 5, end: 2 } }), 'SCHEMA_CUSTOM'),
      ],
    ],
  },
  {
    id: 'sources.file.advice',
    rules: ['Provenance'],
    family: 'sources',
    component: 'store/validate',
    cause:
      'a value, a boundary or a constraint with no provenance is advice only: the store is valid and the warning names each one',
    cases: [
      [
        'a-store-without-provenance-is-valid',
        2,
        (ctx) => {
          const b = baseFile(ctx);
          const r = validateOk(ctx, b.store);
          check(r.ok && r.warnings.length > 0, () => ({
            rule: 'no advice for a store whose entries name no source',
            expected: none('observation'),
          }));
        },
      ],
      [
        'advice-names-every-unsourced-entry',
        3,
        (ctx) => {
          const b = baseFile(ctx);
          const r = callValidate(ctx, b.store);
          check(r.ok, () => ({
            rule: 'the base store was refused: {}',
            got: { details: [show(errorsOf(r), 200)] },
            expected: none('observation'),
          }));
          const paths = (r.ok ? r.warnings : [])
            .filter((w) => w.code === 'VARIABLES_UNSOURCED')
            .map((w) => w.path);
          const values = b.store.variables.reduce((n, v) => n + v.values.length, 0);
          const boundaries = b.store.variables.reduce((n, v) => n + (v.boundaries?.length ?? 0), 0);
          const want = values + boundaries + (b.store.constraints?.length ?? 0);
          check(paths.length === want, () => ({
            rule: 'each entry without provenance is reported as unsourced',
            got: { count: paths.length, paths: show(paths, 300) },
            expected: { count: want },
          }));
          check(
            paths.includes('variables.2.boundaries.0') &&
              paths.includes('constraints.0') &&
              paths.includes('variables.0.values.0'),
            () => ({
              rule: 'paths {} lack a value, a boundary or a constraint',
              got: { details: [show(paths, 300)] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'a-sourced-entry-gets-no-advice',
        3,
        (ctx) => {
          const store = withEntry(ctx, quoteEntry());
          const r = callValidate(ctx, store);
          check(r.ok, () => ({
            rule: 'refused: {}',
            got: { details: [show(errorsOf(r), 200)] },
            expected: none('observation'),
          }));
          const paths = (r.ok ? r.warnings : []).map((w) => w.path);
          check(!paths.includes('variables.2.values.0'), () => ({
            rule: 'advice for a value that names its source',
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'sources.condition.numerals',
    rules: ['R3'],
    family: 'sources',
    component: 'store/estate',
    cause:
      'the reader keeps the numeric quantity of a limit written with signs, separators, number words, currency signs and units',
    cases: [
      ['thousands-separator', 3, drawnCase('gt', 'thousands')],
      ['number-word-two', 3, drawnCase('gt', 'words', { range: [2, 9] })],
      ['number-word-twelve', 3, drawnCase('ge', 'words', { range: [11, 19] })],
      ['number-word-compound', 4, drawnCase('lt', 'words', { range: [21, 99], compound: true })],
      ['dollar-sign', 3, drawnCase('gt', 'dollar')],
      ['euro-sign', 3, drawnCase('le', 'euro')],
      ['percent-sign', 3, drawnCase('lt', 'percent')],
      ['decimal-with-thousands', 4, drawnCase('gt', 'decimal-thousands')],
      ['leading-zero-decimal', 3, drawnCase('ge', 'leading-zero')],
      ['negative-limit-with-a-unit', 4, drawnCase('lt', 'negative')],
      ['space-thousands', 4, drawnCase('gt', 'space-thousands')],
      ['narrow-no-break-thousands', 4, drawnCase('ge', 'narrow-thousands')],
      ['apostrophe-thousands', 4, drawnCase('lt', 'apostrophe-thousands')],
      ['european-decimal-comma', 4, drawnCase('gt', 'european')],
      ['iso-code-before-the-number', 3, drawnCase('le', 'iso-before')],
      ['iso-code-after-the-number', 3, drawnCase('ge', 'iso-after')],
      ['unicode-minus-sign', 4, drawnCase('lt', 'unicode-minus')],
      ['plus-sign', 3, drawnCase('gt', 'plus-sign')],
      ['unit-attached-to-the-number', 3, drawnCase('ge', 'attached-unit')],
      ['hundreds-in-words', 4, drawnCase('gt', 'hundreds-in-words')],
      ['thousands-in-words', 4, drawnCase('lt', 'thousands-in-words')],
      ['and-in-words', 5, drawnCase('ge', 'and-in-words')],
      ['symbol-greater-than', 3, drawnCase('gt', 'sym-gt')],
      ['symbol-at-least-two-characters', 3, drawnCase('ge', 'sym-ge-ascii')],
      ['symbol-at-least-one-character', 4, drawnCase('ge', 'sym-ge-unicode')],
      ['symbol-less-than', 3, drawnCase('lt', 'sym-lt')],
      ['symbol-at-most-two-characters', 3, drawnCase('le', 'sym-le-ascii')],
      ['symbol-at-most-one-character', 4, drawnCase('le', 'sym-le-unicode')],
      ['thousands-written-with-k', 4, drawnCase('gt', 'k-suffix')],
      ['millions-written-with-a-word', 4, drawnCase('lt', 'million-word')],
    ],
  },
  {
    id: 'sources.condition.kinds',
    rules: ['R3'],
    family: 'sources',
    component: 'store/estate',
    cause:
      'equality, inequality, range, boolean and membership conditions get the samples the page lists for each',
    cases: [
      [
        'equality-keeps-all-three-cases',
        4,
        (ctx) => {
          const d = drawEquality(ctx.rng, 'equal');
          const r = readSpans(ctx, [
            declareSpan(d.text, { kind: 'numeric', subject: d.subject, limit: d.limit, flavour: 'equal' }),
          ]);
          const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
          check(
            nums.length >= 3 &&
              nums.some((n) => n < d.limit) &&
              nums.includes(d.limit) &&
              nums.some((n) => n > d.limit),
            () => ({
              rule: 'samples {}; an equality keeps a case below, at and above its limit',
              got: { details: [show(nums)] },
              expected: none('observation'),
            }),
          );
          for (const b of r.variable.boundaries ?? [])
            check(b.comparison === undefined || ['lt', 'le', 'gt', 'ge'].includes(b.comparison), () => ({
              rule: 'boundary comparison {} is not one of lt, le, gt, ge',
              got: { details: [show(b.comparison)] },
              expected: none('observation'),
            }));
        },
      ],
      [
        'inequality-keeps-all-three-cases',
        4,
        (ctx) => {
          const d = drawEquality(ctx.rng, 'unequal');
          const r = readSpans(ctx, [
            declareSpan(d.text, { kind: 'numeric', subject: d.subject, limit: d.limit, flavour: 'unequal' }),
          ]);
          const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
          check(
            nums.length >= 3 &&
              nums.some((n) => n < d.limit) &&
              nums.includes(d.limit) &&
              nums.some((n) => n > d.limit),
            () => ({
              rule: 'samples {}; an inequality keeps a case below, at and above its limit',
              got: { details: [show(nums)] },
              expected: none('observation'),
            }),
          );
          for (const b of r.variable.boundaries ?? [])
            check(b.comparison === undefined || ['lt', 'le', 'gt', 'ge'].includes(b.comparison), () => ({
              rule: 'boundary comparison {} is not one of lt, le, gt, ge',
              got: { details: [show(b.comparison)] },
              expected: none('observation'),
            }));
        },
      ],
      ['range-has-five-cases', 5, rangeCase()],
      ['range-written-with-to', 5, rangeCase('to')],
      ['range-written-with-an-en-dash', 5, rangeCase('en-dash')],
      ['range-written-with-a-hyphen', 5, rangeCase('hyphen')],
      ['range-with-both-ends-open', 5, rangeCase('open')],
      ['range-with-one-end-closed', 5, rangeCase('half-open')],
      ['range-with-a-negative-lower-limit', 5, rangeCase('negative')],
      ['range-with-decimal-limits', 5, rangeCase('decimal')],
      ['membership-written-as-neither-nor', 5, choiceCase('neither')],
      ['membership-written-as-either-or', 5, choiceCase('either')],
      [
        'a-fact-and-its-negation-are-one-variable',
        5,
        (ctx) => {
          const d = drawBooleanPair(ctx.rng);
          const texts = [
            declareSpan(d.positive, { kind: 'boolean', subject: d.subject, word: d.word }),
            declareSpan(d.negated, { kind: 'boolean', subject: d.subject, word: d.word }),
          ];
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: policyFile(ctx.rng, texts) },
              rules: texts.map((t, i) => ({
                id: `rule.${i}`,
                source: PATH,
                conditions: [{ text: t }],
                tools: [],
              })),
            },
          });
          const flags = store.variables.filter(
            (x) => x.values.some((y) => y.sample === true) && x.values.some((y) => y.sample === false),
          );
          check(flags.length === 1, () => ({
            rule: '{} true-or-false variables for a fact and its negation; they name one fact, so one',
            got: { details: [flags.length] },
            expected: none('observation'),
          }));
          check(flags[0]?.values.length === 2, () => ({
            rule: '{} values; true and false',
            got: { details: [flags[0]?.values.length] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'boolean-has-true-and-false',
        5,
        (ctx) => {
          const d = drawBoolean(ctx.rng);
          const text = declareSpan(d.text, { kind: 'boolean', subject: d.subject, word: d.word });
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: policyFile(ctx.rng, [text]) },
              rules: [{ id: 'rule.flag', source: PATH, conditions: [{ text }], tools: [] }],
            },
          });
          const v = store.variables.find(
            (x) => x.values.some((y) => y.sample === true) && x.values.some((y) => y.sample === false),
          );
          check(!!v, () => ({
            rule: 'no variable with a true and a false sample: {}',
            got: {
              details: [
                show(
                  store.variables.map((x) => x.values.map((y) => y.sample)),
                  200,
                ),
              ],
            },
            expected: none('observation'),
          }));
          check(v?.values.length === 2, () => ({
            rule: '{} values for a boolean condition; two',
            got: { details: [v?.values.length] },
            expected: none('observation'),
          }));
          check((v?.boundaries ?? []).length === 0, () => ({
            rule: 'a boolean condition has no numeric boundary',
            expected: none('observation'),
          }));
        },
      ],
      [
        'membership-has-an-in-list-and-an-out-of-list-sample',
        5,
        (ctx) => {
          const d = drawMembership(ctx.rng);
          const text = declareSpan(d.text, { kind: 'member', subject: d.subject, list: d.list });
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: policyFile(ctx.rng, [text]) },
              rules: [{ id: 'rule.country', source: PATH, conditions: [{ text }], tools: [] }],
            },
          });
          const v = store.variables.find((x) => x.values.some((y) => typeof y.sample === 'string'));
          check(!!v, () => ({
            rule: 'no variable with string samples: {}',
            got: {
              details: [
                show(
                  store.variables.map((x) => x.values.map((y) => y.sample)),
                  200,
                ),
              ],
            },
            expected: none('observation'),
          }));
          const samples = (v?.values ?? []).map((y) => String(y.sample));
          check(
            samples.some((s) => d.list.includes(s)),
            () => ({
              rule: 'samples {} lack a member of the list {}',
              got: { details: [show(samples), show(d.list)] },
              expected: none('observation'),
            }),
          );
          check(
            samples.some((s) => !d.list.includes(s)),
            () => ({
              rule: 'samples {} lack a value outside the list {}',
              got: { details: [show(samples), show(d.list)] },
              expected: none('observation'),
            }),
          );
          check((v?.boundaries ?? []).length === 0, () => ({
            rule: 'a membership condition has no numeric boundary',
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'sources.merge',
    rules: ['R4'],
    family: 'sources',
    component: 'store/merge',
    cause:
      'spans naming one quantity merge into one variable, other quantities and tool fields stay distinct, and a rule lists every variable of its conditions and tools',
    cases: [
      [
        'different-quantities-stay-distinct',
        3,
        (ctx) => {
          const first = drawCondition(ctx.rng, 'gt', 'plain');
          let second = drawCondition(ctx.rng, 'gt', 'plain');
          while (second.subject === first.subject) second = drawCondition(ctx.rng, 'gt', 'plain');
          const texts = [first, second].map((d) => numeric(d.text, d.subject, d.limit, d.cmp));
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: policyFile(ctx.rng, texts) },
              rules: texts.map((t, i) => ({
                id: `rule.${i}`,
                source: PATH,
                conditions: [{ text: t }],
                tools: [],
              })),
            },
          });
          const withSamples = store.variables.filter((v) =>
            v.values.some((x) => typeof x.sample === 'number'),
          );
          check(withSamples.length === 2, () => ({
            rule: '{} variables for a delay and a refund; two quantities stay two variables',
            got: { details: [withSamples.length] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'repeated-tool-field-merges-by-field',
        3,
        (ctx) => {
          const t1: ToolSpec = {
            tool: lex('router_tool'),
            field: lex('queue'),
            values: [lex('alpha'), lex('beta')],
          };
          const t2: ToolSpec = {
            tool: lex('router_tool'),
            field: lex('queue'),
            values: [lex('beta'), lex('gamma')],
          };
          const q = (t: ToolSpec, v: string) => quoteFor(t, v);
          const text = [...t1.values.map((v) => q(t1, v)), ...t2.values.map((v) => q(t2, v))].join('\n');
          const estate = {
            files: { [PATH]: text },
            rules: [t1, t2].map((t, i) => ({
              id: `rule.${i}`,
              source: PATH,
              conditions: [],
              tools: [
                {
                  tool: t.tool,
                  field: t.field,
                  source: PATH,
                  values: t.values.map((v) => ({ id: v, quote: q(t, v) })),
                },
              ],
            })),
          };
          const store = callBuild(ctx, { estate });
          check(store.variables.length === 1, () => ({
            rule: '{} variables for one tool field named in two rules',
            got: { details: [store.variables.length] },
            expected: none('observation'),
          }));
          const ids = (store.variables[0]?.values ?? []).map((x) => x.id).sort();
          check(
            JSON.stringify(ids) === JSON.stringify([lex('alpha'), lex('beta'), lex('gamma')].sort()),
            () => ({
              rule: 'values {}; the union of both rules, each once',
              got: { details: [show(ids)] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'the-same-field-name-on-two-tools-stays-two-variables',
        3,
        (ctx) => {
          const tools: ToolSpec[] = [
            { tool: lex('alpha_tool'), field: lex('mode'), values: [lex('a1'), lex('a2')] },
            { tool: lex('beta_tool'), field: lex('mode'), values: [lex('b1'), lex('b2')] },
          ];
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          check(store.variables.length === 2, () => ({
            rule: '{} variables for two tools with a field of the same name',
            got: { details: [store.variables.length] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'a-rule-lists-every-variable-it-names',
        3,
        (ctx) => {
          const tool: ToolSpec = {
            tool: lex('router_tool'),
            field: lex('queue'),
            values: [lex('alpha'), lex('beta')],
          };
          const q = (v: string) => quoteFor(tool, v);
          const spans = [
            numeric('the delay is more than 2 days', 'the delay', 2, 'gt'),
            numeric('the refund is under 30 euros', 'the refund', 30, 'lt'),
          ];
          const text = [...tool.values.map(q), ...spans.map((s) => `Escalate when ${s}.`)].join('\n');
          const estate = {
            files: { [PATH]: text },
            rules: [
              {
                id: 'rule.main',
                source: PATH,
                conditions: spans.map((s) => ({ text: s })),
                tools: [
                  {
                    tool: tool.tool,
                    field: tool.field,
                    source: PATH,
                    values: tool.values.map((v) => ({ id: v, quote: q(v) })),
                  },
                ],
              },
            ],
          };
          const store = callBuild(ctx, { estate });
          const rule = store.rules.find((r) => r.id === 'rule.main');
          check(!!rule, () => ({
            rule: 'the store lists the rule of the estate',
            got: { rules: show(store.rules) },
            expected: { rule: 'rule.main' },
          }));
          check(new Set(rule?.variables).size === 3 && rule?.variables.length === 3, () => ({
            rule: 'rule variables {}; the rule names two conditions and one tool field',
            got: { details: [show(rule?.variables)] },
            expected: none('observation'),
          }));
          for (const id of rule?.variables ?? [])
            check(
              store.variables.some((v) => v.id === id),
              () => ({
                rule: 'the rule names {}, which is no variable of the store',
                got: { details: [id] },
                expected: none('observation'),
              }),
            );
        },
      ],
      [
        'every-rule-is-listed',
        2,
        (ctx) => {
          const tools: ToolSpec[] = [
            { tool: lex('a_tool'), field: lex('f1'), values: [lex('x1'), lex('x2')] },
            { tool: lex('b_tool'), field: lex('f2'), values: [lex('y1'), lex('y2')] },
            { tool: lex('c_tool'), field: lex('f3'), values: [lex('z1'), lex('z2')] },
          ];
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          const got = store.rules.map((r) => r.id).sort();
          const want = estate.rules.map((r) => r.id).sort();
          check(JSON.stringify(got) === JSON.stringify(want), () => ({
            rule: 'the store lists the rules of the estate',
            got: { rules: show(got) },
            expected: { rules: show(want) },
          }));
        },
      ],
      [
        'a-variable-shared-by-two-rules-is-in-both',
        4,
        (ctx) => {
          const tool: ToolSpec = {
            tool: lex('router_tool'),
            field: lex('queue'),
            values: [lex('alpha'), lex('beta')],
          };
          const q = (v: string) => quoteFor(tool, v);
          const mk = (id: string) => ({
            id,
            source: PATH,
            conditions: [],
            tools: [
              {
                tool: tool.tool,
                field: tool.field,
                source: PATH,
                values: tool.values.map((v) => ({ id: v, quote: q(v) })),
              },
            ],
          });
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: tool.values.map(q).join('\n') },
              rules: [mk('rule.one'), mk('rule.two')],
            },
          });
          const one = store.rules.find((r) => r.id === 'rule.one');
          const two = store.rules.find((r) => r.id === 'rule.two');
          check(
            !!one &&
              !!two &&
              one.variables.length === 1 &&
              JSON.stringify(one.variables) === JSON.stringify(two.variables),
            () => ({
              rule: 'rules {}; both rules name the one variable',
              got: { details: [show(store.rules)] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'a-rule-with-nothing-to-read-adds-no-variable',
        3,
        (ctx) => {
          const store = callBuild(ctx, {
            estate: {
              files: { [PATH]: 'Nothing here.' },
              rules: [{ id: 'rule.empty', source: PATH, conditions: [], tools: [] }],
            },
          });
          check(store.variables.length === 0, () => ({
            rule: '{} variables from a rule with no condition and no tool',
            got: { details: [store.variables.length] },
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'sources.provenance',
    rules: ['R1'],
    family: 'sources',
    component: 'store/merge',
    cause:
      'every reader value keeps provenance from its actual source, and a value known to several sources keeps one entry of each source kind',
    cases: [
      [
        'every-estate-value-names-a-quote',
        1,
        (ctx) => {
          const { estate } = estateFor(TOOLS());
          const store = callBuild(ctx, { estate });
          for (const v of store.variables)
            for (const x of v.values) {
              const q = x.provenance?.find((p) => p.kind === 'quote');
              check(q?.kind === 'quote' && q.path === 'agent/prompt.md' && q.quote.length > 0, () => ({
                rule: 'value {} has provenance {}',
                got: { details: [x.id, show(x.provenance)] },
                expected: none('observation'),
              }));
            }
        },
      ],
      [
        'a-value-known-to-three-sources-keeps-three-entries',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                [lex('alpha'), 3],
                [lex('beta'), 1],
              ]),
            ),
            owner: {
              values: [
                { variable: id, value: lex('alpha'), words: 'Alpha is our common queue.', date: OWNER_DATE },
              ],
            },
          });
          const alpha = store.variables.find((v) => v.id === id)?.values.find((x) => x.id === lex('alpha'));
          const kinds = (alpha?.provenance ?? []).map((p) => p.kind).sort();
          check(JSON.stringify(kinds) === JSON.stringify(['conversations', 'owner', 'quote']), () => ({
            rule: 'provenance kinds {}; one entry for each of the three sources',
            got: { details: [show(kinds)] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'sources-merge-without-losing-the-estate-quote',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const before = d.store.variables
            .find((v) => v.id === id)
            ?.values.find((x) => x.id === lex('beta'))
            ?.provenance?.find((p) => p.kind === 'quote');
          const store = d.build({ conversations: conversationsOf(sessions(id, [[lex('beta'), 2]])) });
          const after = store.variables
            .find((v) => v.id === id)
            ?.values.find((x) => x.id === lex('beta'))
            ?.provenance?.find((p) => p.kind === 'quote');
          check(JSON.stringify(before) === JSON.stringify(after) && !!after, () => ({
            rule: 'quote entry {} became {}',
            got: { details: [show(before), show(after)] },
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'sources.conversations',
    rules: ['R5'],
    family: 'sources',
    component: 'store/conversations',
    cause:
      'conversations add counts and a hash of the set to values, create unapproved proposals for unknown values, refuse unknown variables, and keep no text',
    cases: [
      [
        'counts-per-value',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                [lex('alpha'), 5],
                [lex('beta'), 3],
                [lex('gamma'), 2],
              ]),
            ),
          });
          for (const [v, n] of [
            [lex('alpha'), 5],
            [lex('beta'), 3],
            [lex('gamma'), 2],
          ] as const) {
            const e = convOf(store, id, v);
            check(e?.kind === 'conversations' && e.count === n && e.total === 10, () => ({
              rule: 'a value seen in conversations carries how often it was seen',
              input: { value: v },
              got: { entry: show(e) },
              expected: { count: n, total: 10 },
            }));
          }
        },
      ],
      [
        'unknown-value-becomes-an-unapproved-proposal',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                [lex('alpha'), 6],
                ['stranger', 4],
              ]),
            ),
          });
          const v = store.variables.find((x) => x.id === id)?.values.find((x) => x.id === 'stranger');
          check(!!v && v.approved === false, () => ({
            rule: 'stranger is {}; a value seen and unknown is an unapproved proposal',
            got: { details: [show(v)] },
            expected: none('observation'),
          }));
          const e = v?.provenance?.find((p) => p.kind === 'conversations');
          check(e?.kind === 'conversations' && e.count === 4 && e.total === 10, () => ({
            rule: 'stranger provenance {}',
            got: { details: [show(e)] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'unknown-variable-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const store = d.build({
            conversations: conversationsOf([{ ghost_variable: 'x' }, { ghost_variable: 'y' }]),
          });
          check(!store.variables.some((v) => v.id === 'ghost_variable'), () => ({
            rule: 'a variable seen only in conversations was created',
            expected: none('observation'),
          }));
          check(
            store.refused.length >= 1 && store.refused.some((r) => r.what.includes('ghost_variable')),
            () => ({
              rule: 'refused {} does not name ghost_variable',
              got: { details: [show(store.refused)] },
              expected: none('observation'),
            }),
          );
          for (const r of store.refused)
            check(r.reason.length >= 8 && r.reason !== r.what, () => ({
              rule: 'reason {}',
              got: { details: [show(r.reason)] },
              expected: none('observation'),
            }));
        },
      ],
      [
        'set-hash-has-the-shape-of-a-sha-256',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                [lex('alpha'), 2],
                [lex('beta'), 2],
              ]),
            ),
          });
          for (const h of hashes(store, id))
            check(/^[0-9a-f]{64}$/.test(h), () => ({
              rule: 'set_hash {} is not N lowercase hexadecimal characters',
              got: { details: [show(h)] },
              expected: none('observation'),
            }));
          check(hashes(store, id).length === 3, () => ({
            rule: '{} conversation entries for three values',
            got: { details: [hashes(store, id).length] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'set-hash-does-not-depend-on-the-order-of-sessions',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const rows = conversationsOf(
            sessions(id, [
              [lex('alpha'), 3],
              [lex('beta'), 2],
              [lex('gamma'), 1],
            ]),
          );
          const a = d.build({ conversations: rows });
          const b = d.build({ conversations: [...rows].reverse() });
          check(JSON.stringify(hashes(a, id)) === JSON.stringify(hashes(b, id)), () => ({
            rule: 'the hash of the set changed when the sessions came in another order',
            expected: none('observation'),
          }));
        },
      ],
      [
        'set-hash-changes-when-a-session-changes',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const rows = conversationsOf(
            sessions(id, [
              [lex('alpha'), 3],
              [lex('beta'), 2],
            ]),
          );
          const changed = clone(rows);
          (changed[0] as { values: Row }).values[id] = lex('gamma');
          const a = d.build({ conversations: rows });
          const b = d.build({ conversations: changed });
          check(JSON.stringify(hashes(a, id)) !== JSON.stringify(hashes(b, id)), () => ({
            rule: 'the hash of the set did not change when one session changed',
            expected: none('observation'),
          }));
        },
      ],
      [
        'no-text-and-no-identifier-enters-the-store',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const id = d.ids[0] as string;
          const rows = conversationsOf(
            sessions(id, [
              [lex('alpha'), 3],
              [lex('beta'), 2],
            ]),
          ).map((r, i) => ({
            ...r,
            id: `private-session-${i}-zq81`,
            text: `PRIVATE_LINE_${i}_qq72 call me on 555-0100`,
          }));
          const store = d.build({ conversations: rows });
          const dump = JSON.stringify(store);
          check(
            !dump.includes('private-session') && !dump.includes('PRIVATE_LINE') && !dump.includes('555-0100'),
            () => ({
              rule: 'conversation text or identifiers reached the store',
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'empty-conversations-add-nothing',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const store = d.build({ conversations: [] });
          check(JSON.stringify(store) === JSON.stringify(d.store), () => ({
            rule: 'an empty conversation list changed the store',
            expected: none('observation'),
          }));
        },
      ],
      [
        'conversations-never-touch-the-other-variables',
        3,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const [id, other] = d.ids as [string, string];
          const store = d.build({
            conversations: conversationsOf(
              sessions(id, [
                [lex('alpha'), 2],
                [lex('beta'), 2],
              ]),
            ),
          });
          const before = d.store.variables.find((v) => v.id === other);
          const after = store.variables.find((v) => v.id === other);
          check(JSON.stringify(before) === JSON.stringify(after), () => ({
            rule: 'a variable no conversation showed changed',
            expected: none('observation'),
          }));
        },
      ],
      [
        'sessions-showing-two-variables-count-each-once',
        4,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const [a, b] = d.ids as [string, string];
          const rows: Row[] = [
            { [a]: lex('alpha'), [b]: lex('warm') },
            { [a]: lex('alpha'), [b]: lex('brisk') },
            { [a]: lex('beta') },
            { [b]: lex('warm') },
          ];
          const store = d.build({ conversations: conversationsOf(rows) });
          const ea = convOf(store, a, lex('alpha'));
          const eb = convOf(store, b, lex('warm'));
          check(ea?.kind === 'conversations' && ea.count === 2 && ea.total === 3, () => ({
            rule: 'a value seen in some of the sessions that show its variable carries how often',
            input: { value: 'alpha' },
            got: { entry: show(ea) },
            expected: { count: 2, total: 3 },
          }));
          check(eb?.kind === 'conversations' && eb.count === 2 && eb.total === 3, () => ({
            rule: 'a value seen in some of the sessions that show its variable carries how often',
            input: { value: 'warm' },
            got: { entry: show(eb) },
            expected: { count: 2, total: 3 },
          }));
        },
      ],
    ],
  },
  {
    id: 'sources.estate-and-owner',
    rules: ['R1', 'R5'],
    family: 'sources',
    component: 'store/merge',
    cause: 'one call merges the three sources into one store without losing a source',
    cases: [
      [
        'all-three-sources-in-one-call',
        4,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const [a, b] = d.ids as [string, string];
          const store = d.build({
            conversations: conversationsOf(
              sessions(a, [
                [lex('alpha'), 4],
                [lex('beta'), 2],
              ]),
            ),
            owner: {
              values: [
                {
                  variable: b,
                  value: lex('curt'),
                  words: 'We sometimes write curt mails.',
                  date: OWNER_DATE,
                },
              ],
              impossible: [pairOf([a, lex('alpha')], [b, lex('curt')])],
              weights: [
                { variable: b, value: lex('warm'), weight: 3, words: 'Mostly warm.', date: OWNER_DATE },
                { variable: b, value: lex('brisk'), weight: 1, words: 'Rarely brisk.', date: OWNER_DATE },
                { variable: b, value: lex('curt'), weight: 1, words: 'Rarely curt.', date: OWNER_DATE },
              ],
            },
          });
          check(!!varOf(store, [lex('warm'), lex('brisk'), lex('curt')]), () => ({
            rule: 'the owner value is not in the variable',
            expected: none('observation'),
          }));
          check(store.impossible.length === 1, () => ({
            rule: '{} impossible pairs; the owner gave one',
            got: { details: [store.impossible.length] },
            expected: none('observation'),
          }));
          check(convOf(store, a, lex('alpha'))?.kind === 'conversations', () => ({
            rule: 'the conversation counts are gone',
            expected: none('observation'),
          }));
          const weightOf = (value: string): number | undefined =>
            store.variables.find((v) => v.id === b)?.values.find((x) => x.id === value)?.weight;
          const w = [lex('warm'), lex('brisk'), lex('curt')].map(weightOf);
          check(JSON.stringify(w) === JSON.stringify([3, 1, 1]), () => ({
            rule: 'owner weights {}',
            got: { details: [show(w)] },
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
];
