import type { ItemContext } from '../../bank/item';
import { clone } from '../../bank/util';
import type { FileProvenance, Row } from '../../interface';
import { drawnCase, PATH, readSpans } from '../conditions';
import { drawBoolean, drawCondition, drawEquality, drawMembership, drawRange, policyFile } from '../draws';
import { baseFile, defect, errorsOf, validateIssue, validateIssueAt, validateOk, variableOf } from '../files';
import { callBuild, callValidate, must, type Stem, show } from '../kit';
import { conversationsOf, discover, estateFor, OWNER_DATE, pairOf, type ToolSpec, varOf } from '../scene';
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
    must(
      errors.some((e) => e.code === code),
      () => `no ${code} among ${show(errors, 240)}`,
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

export const SOURCES_STEMS: readonly Stem[] = [
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
          must(
            errors.some(
              (e) => e.path === `${ENTRY}.quote` && ['SCHEMA_TOO_SMALL', 'SCHEMA_CUSTOM'].includes(e.code),
            ),
            () => `no SCHEMA_TOO_SMALL or SCHEMA_CUSTOM at ${ENTRY}.quote among ${show(errors, 240)}`,
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
          must(r.ok && r.warnings.length > 0, () => 'no advice for a store whose entries name no source');
        },
      ],
      [
        'advice-names-every-unsourced-entry',
        3,
        (ctx) => {
          const b = baseFile(ctx);
          const r = callValidate(ctx, b.store);
          must(r.ok, () => `the base store was refused: ${show(errorsOf(r), 200)}`);
          const paths = (r.ok ? r.warnings : [])
            .filter((w) => w.code === 'VARIABLES_UNSOURCED')
            .map((w) => w.path);
          const values = b.store.variables.reduce((n, v) => n + v.values.length, 0);
          const boundaries = b.store.variables.reduce((n, v) => n + (v.boundaries?.length ?? 0), 0);
          const want = values + boundaries + (b.store.constraints?.length ?? 0);
          must(
            paths.length === want,
            () =>
              `${paths.length} VARIABLES_UNSOURCED for ${want} entries without provenance: ${show(paths, 300)}`,
          );
          must(
            paths.includes('variables.2.boundaries.0') &&
              paths.includes('constraints.0') &&
              paths.includes('variables.0.values.0'),
            () => `paths ${show(paths, 300)} lack a value, a boundary or a constraint`,
          );
        },
      ],
      [
        'a-sourced-entry-gets-no-advice',
        3,
        (ctx) => {
          const store = withEntry(ctx, quoteEntry());
          const r = callValidate(ctx, store);
          must(r.ok, () => `refused: ${show(errorsOf(r), 200)}`);
          const paths = (r.ok ? r.warnings : []).map((w) => w.path);
          must(!paths.includes('variables.2.values.0'), () => 'advice for a value that names its source');
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
          must(
            nums.length >= 3 && nums.some((n) => n < d.limit) && nums.includes(d.limit) && nums.some((n) => n > d.limit),
            () => `samples ${show(nums)}; an equality keeps a case below, at and above its limit`,
          );
          for (const b of r.variable.boundaries ?? [])
            must(
              b.comparison === undefined || ['lt', 'le', 'gt', 'ge'].includes(b.comparison),
              () => `boundary comparison ${show(b.comparison)} is not one of lt, le, gt, ge`,
            );
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
          must(
            nums.length >= 3 && nums.some((n) => n < d.limit) && nums.includes(d.limit) && nums.some((n) => n > d.limit),
            () => `samples ${show(nums)}; an inequality keeps a case below, at and above its limit`,
          );
          for (const b of r.variable.boundaries ?? [])
            must(
              b.comparison === undefined || ['lt', 'le', 'gt', 'ge'].includes(b.comparison),
              () => `boundary comparison ${show(b.comparison)} is not one of lt, le, gt, ge`,
            );
        },
      ],
      [
        'range-has-five-cases',
        5,
        (ctx) => {
          const d = drawRange(ctx.rng);
          const r = readSpans(ctx, [
            declareSpan(d.text, { kind: 'range', subject: d.subject, lo: d.lo, hi: d.hi }),
          ]);
          const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
          must(new Set(nums).size === nums.length, () => `samples ${show(nums)} repeat a number`);
          must(
            nums.some((n) => n < d.lo) &&
              nums.includes(d.lo) &&
              nums.some((n) => n > d.lo && n < d.hi) &&
              nums.includes(d.hi) &&
              nums.some((n) => n > d.hi),
            () => `samples ${show(nums)} lack one of: below ${d.lo}, at ${d.lo}, strictly inside, at ${d.hi}, above ${d.hi}`,
          );
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
          must(
            !!v,
            () =>
              `no variable with a true and a false sample: ${show(
                store.variables.map((x) => x.values.map((y) => y.sample)),
                200,
              )}`,
          );
          must(v?.values.length === 2, () => `${v?.values.length} values for a boolean condition; two`);
          must((v?.boundaries ?? []).length === 0, () => 'a boolean condition has no numeric boundary');
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
          must(
            !!v,
            () =>
              `no variable with string samples: ${show(
                store.variables.map((x) => x.values.map((y) => y.sample)),
                200,
              )}`,
          );
          const samples = (v?.values ?? []).map((y) => String(y.sample));
          must(
            samples.some((s) => d.list.includes(s)),
            () => `samples ${show(samples)} lack a member of the list ${show(d.list)}`,
          );
          must(
            samples.some((s) => !d.list.includes(s)),
            () => `samples ${show(samples)} lack a value outside the list ${show(d.list)}`,
          );
          must((v?.boundaries ?? []).length === 0, () => 'a membership condition has no numeric boundary');
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
          must(
            withSamples.length === 2,
            () =>
              `${withSamples.length} variables for a delay and a refund; two quantities stay two variables`,
          );
        },
      ],
      [
        'repeated-tool-field-merges-by-field',
        3,
        (ctx) => {
          const t1: ToolSpec = { tool: 'router_tool', field: 'queue', values: ['alpha', 'beta'] };
          const t2: ToolSpec = { tool: 'router_tool', field: 'queue', values: ['beta', 'gamma'] };
          const text = [
            ...t1.values.map((v) => `When the queue of router_tool is ${v}, the agent acts on it.`),
            ...t2.values.map((v) => `When the queue of router_tool is ${v}, the agent acts on it.`),
          ].join('\n');
          const q = (t: ToolSpec, v: string) => `When the queue of ${t.tool} is ${v}, the agent acts on it.`;
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
          must(
            store.variables.length === 1,
            () => `${store.variables.length} variables for one tool field named in two rules`,
          );
          const ids = (store.variables[0]?.values ?? []).map((x) => x.id).sort();
          must(
            JSON.stringify(ids) === JSON.stringify(['alpha', 'beta', 'gamma']),
            () => `values ${show(ids)}; the union of both rules, each once`,
          );
        },
      ],
      [
        'the-same-field-name-on-two-tools-stays-two-variables',
        3,
        (ctx) => {
          const tools: ToolSpec[] = [
            { tool: 'alpha_tool', field: 'mode', values: ['a1', 'a2'] },
            { tool: 'beta_tool', field: 'mode', values: ['b1', 'b2'] },
          ];
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          must(
            store.variables.length === 2,
            () => `${store.variables.length} variables for two tools with a field of the same name`,
          );
        },
      ],
      [
        'a-rule-lists-every-variable-it-names',
        3,
        (ctx) => {
          const tool: ToolSpec = { tool: 'router_tool', field: 'queue', values: ['alpha', 'beta'] };
          const q = (v: string) => `When the queue of router_tool is ${v}, the agent acts on it.`;
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
          must(!!rule, () => `rules ${show(store.rules)} lack rule.main`);
          must(
            new Set(rule?.variables).size === 3 && rule?.variables.length === 3,
            () => `rule variables ${show(rule?.variables)}; the rule names two conditions and one tool field`,
          );
          for (const id of rule?.variables ?? [])
            must(
              store.variables.some((v) => v.id === id),
              () => `the rule names ${id}, which is no variable of the store`,
            );
        },
      ],
      [
        'every-rule-is-listed',
        2,
        (ctx) => {
          const tools: ToolSpec[] = [
            { tool: 'a_tool', field: 'f1', values: ['x1', 'x2'] },
            { tool: 'b_tool', field: 'f2', values: ['y1', 'y2'] },
            { tool: 'c_tool', field: 'f3', values: ['z1', 'z2'] },
          ];
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          const got = store.rules.map((r) => r.id).sort();
          const want = estate.rules.map((r) => r.id).sort();
          must(
            JSON.stringify(got) === JSON.stringify(want),
            () => `rules ${show(got)}; expected ${show(want)}`,
          );
        },
      ],
      [
        'a-variable-shared-by-two-rules-is-in-both',
        4,
        (ctx) => {
          const tool: ToolSpec = { tool: 'router_tool', field: 'queue', values: ['alpha', 'beta'] };
          const q = (v: string) => `When the queue of router_tool is ${v}, the agent acts on it.`;
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
          must(
            !!one &&
              !!two &&
              one.variables.length === 1 &&
              JSON.stringify(one.variables) === JSON.stringify(two.variables),
            () => `rules ${show(store.rules)}; both rules name the one variable`,
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
          must(
            store.variables.length === 0,
            () => `${store.variables.length} variables from a rule with no condition and no tool`,
          );
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
              must(
                q?.kind === 'quote' && q.path === 'agent/prompt.md' && q.quote.length > 0,
                () => `value ${x.id} has provenance ${show(x.provenance)}`,
              );
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
                ['alpha', 3],
                ['beta', 1],
              ]),
            ),
            owner: {
              values: [
                { variable: id, value: 'alpha', words: 'Alpha is our common queue.', date: OWNER_DATE },
              ],
            },
          });
          const alpha = store.variables.find((v) => v.id === id)?.values.find((x) => x.id === 'alpha');
          const kinds = (alpha?.provenance ?? []).map((p) => p.kind).sort();
          must(
            JSON.stringify(kinds) === JSON.stringify(['conversations', 'owner', 'quote']),
            () => `provenance kinds ${show(kinds)}; one entry for each of the three sources`,
          );
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
            ?.values.find((x) => x.id === 'beta')
            ?.provenance?.find((p) => p.kind === 'quote');
          const store = d.build({ conversations: conversationsOf(sessions(id, [['beta', 2]])) });
          const after = store.variables
            .find((v) => v.id === id)
            ?.values.find((x) => x.id === 'beta')
            ?.provenance?.find((p) => p.kind === 'quote');
          must(
            JSON.stringify(before) === JSON.stringify(after) && !!after,
            () => `quote entry ${show(before)} became ${show(after)}`,
          );
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
                ['alpha', 5],
                ['beta', 3],
                ['gamma', 2],
              ]),
            ),
          });
          for (const [v, n] of [
            ['alpha', 5],
            ['beta', 3],
            ['gamma', 2],
          ] as const) {
            const e = convOf(store, id, v);
            must(
              e?.kind === 'conversations' && e.count === n && e.total === 10,
              () => `${v}: ${show(e)}; expected ${n} of 10`,
            );
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
                ['alpha', 6],
                ['stranger', 4],
              ]),
            ),
          });
          const v = store.variables.find((x) => x.id === id)?.values.find((x) => x.id === 'stranger');
          must(
            !!v && v.approved === false,
            () => `stranger is ${show(v)}; a value seen and unknown is an unapproved proposal`,
          );
          const e = v?.provenance?.find((p) => p.kind === 'conversations');
          must(
            e?.kind === 'conversations' && e.count === 4 && e.total === 10,
            () => `stranger provenance ${show(e)}`,
          );
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
          must(
            !store.variables.some((v) => v.id === 'ghost_variable'),
            () => 'a variable seen only in conversations was created',
          );
          must(
            store.refused.length >= 1 && store.refused.some((r) => r.what.includes('ghost_variable')),
            () => `refused ${show(store.refused)} does not name ghost_variable`,
          );
          for (const r of store.refused)
            must(r.reason.length >= 8 && r.reason !== r.what, () => `reason ${show(r.reason)}`);
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
                ['alpha', 2],
                ['beta', 2],
              ]),
            ),
          });
          for (const h of hashes(store, id))
            must(
              /^[0-9a-f]{64}$/.test(h),
              () => `set_hash ${show(h)} is not 64 lowercase hexadecimal characters`,
            );
          must(
            hashes(store, id).length === 3,
            () => `${hashes(store, id).length} conversation entries for three values`,
          );
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
              ['alpha', 3],
              ['beta', 2],
              ['gamma', 1],
            ]),
          );
          const a = d.build({ conversations: rows });
          const b = d.build({ conversations: [...rows].reverse() });
          must(
            JSON.stringify(hashes(a, id)) === JSON.stringify(hashes(b, id)),
            () => 'the hash of the set changed when the sessions came in another order',
          );
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
              ['alpha', 3],
              ['beta', 2],
            ]),
          );
          const changed = clone(rows);
          (changed[0] as { values: Row }).values[id] = 'gamma';
          const a = d.build({ conversations: rows });
          const b = d.build({ conversations: changed });
          must(
            JSON.stringify(hashes(a, id)) !== JSON.stringify(hashes(b, id)),
            () => 'the hash of the set did not change when one session changed',
          );
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
              ['alpha', 3],
              ['beta', 2],
            ]),
          ).map((r, i) => ({
            ...r,
            id: `private-session-${i}-zq81`,
            text: `PRIVATE_LINE_${i}_qq72 call me on 555-0100`,
          }));
          const store = d.build({ conversations: rows });
          const dump = JSON.stringify(store);
          must(
            !dump.includes('private-session') && !dump.includes('PRIVATE_LINE') && !dump.includes('555-0100'),
            () => 'conversation text or identifiers reached the store',
          );
        },
      ],
      [
        'empty-conversations-add-nothing',
        2,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const store = d.build({ conversations: [] });
          must(
            JSON.stringify(store) === JSON.stringify(d.store),
            () => 'an empty conversation list changed the store',
          );
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
                ['alpha', 2],
                ['beta', 2],
              ]),
            ),
          });
          const before = d.store.variables.find((v) => v.id === other);
          const after = store.variables.find((v) => v.id === other);
          must(
            JSON.stringify(before) === JSON.stringify(after),
            () => 'a variable no conversation showed changed',
          );
        },
      ],
      [
        'sessions-showing-two-variables-count-each-once',
        4,
        (ctx) => {
          const d = discover(ctx, TOOLS());
          const [a, b] = d.ids as [string, string];
          const rows: Row[] = [
            { [a]: 'alpha', [b]: 'warm' },
            { [a]: 'alpha', [b]: 'brisk' },
            { [a]: 'beta' },
            { [b]: 'warm' },
          ];
          const store = d.build({ conversations: conversationsOf(rows) });
          const ea = convOf(store, a, 'alpha');
          const eb = convOf(store, b, 'warm');
          must(
            ea?.kind === 'conversations' && ea.count === 2 && ea.total === 3,
            () => `alpha: ${show(ea)}; expected 2 of 3`,
          );
          must(
            eb?.kind === 'conversations' && eb.count === 2 && eb.total === 3,
            () => `warm: ${show(eb)}; expected 2 of 3`,
          );
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
                ['alpha', 4],
                ['beta', 2],
              ]),
            ),
            owner: {
              values: [
                { variable: b, value: 'curt', words: 'We sometimes write curt mails.', date: OWNER_DATE },
              ],
              impossible: [pairOf([a, 'alpha'], [b, 'curt'])],
              weights: [
                { variable: b, value: 'warm', weight: 3, words: 'Mostly warm.', date: OWNER_DATE },
                { variable: b, value: 'brisk', weight: 1, words: 'Rarely brisk.', date: OWNER_DATE },
                { variable: b, value: 'curt', weight: 1, words: 'Rarely curt.', date: OWNER_DATE },
              ],
            },
          });
          must(!!varOf(store, ['warm', 'brisk', 'curt']), () => 'the owner value is not in the variable');
          must(
            store.impossible.length === 1,
            () => `${store.impossible.length} impossible pairs; the owner gave one`,
          );
          must(convOf(store, a, 'alpha')?.kind === 'conversations', () => 'the conversation counts are gone');
          const weightOf = (value: string): number | undefined =>
            store.variables.find((v) => v.id === b)?.values.find((x) => x.id === value)?.weight;
          const w = ['warm', 'brisk', 'curt'].map(weightOf);
          must(JSON.stringify(w) === JSON.stringify([3, 1, 1]), () => `owner weights ${show(w)}`);
        },
      ],
    ],
  },
];
