import type { ItemContext } from '../../bank/item';
import { attempt } from '../../bank/util';
import type {
  FileProvenance,
  FileStore,
  FileValue,
  FileVariable,
  Group,
  Row,
  StoreDoc,
  VariablesImpl,
} from '../../interface';
import { type Base, baseFile, defect, validateIssue, validateOk, variableOf } from '../files';
import {
  assertCovered,
  assertRowsSound,
  type BlindFamily,
  callBuild,
  callCoverage,
  callInterval,
  callPlan,
  callQuotes,
  callValidate,
  jsonEqual,
  makeStore,
  must,
  names,
  need,
  newRows,
  type Stem,
  show,
  spaceOf,
  valueIds,
} from '../kit';

/**
 * Items added after the first audit of the variables bank (four seats failed it on the same head). They close
 * the gaps the seats named:
 *   - a gate per function of the interface, so a function the adapter does not map is one named cause;
 *   - a value id shared by axes of different kinds (the four kinds the page names together);
 *   - a pair of two values of one variable, worded in other ways, beside a one-entry constraint;
 *   - a quote check on a store file that has no `constraints` key.
 * Items added after the second audit (the cheater and planted-bugs seats failed the bank on bd2510d2d):
 *   - the interval refuses what is outside its domain (R13);
 *   - the count over 20,000 rows, and a forbid that is not approved (R7, R12);
 *   - the quote check on a file of five megabytes and on a quote with an emoji (R2);
 *   - a boundary that quotes a passage joins the rule of that passage (Planning rows).
 */

// ---------------------------------------------------------------------------------------------------------------
// The gate of each function of the interface.

type Gate = {
  id: string;
  family: BlindFamily;
  component: string;
  rule: string;
  run: (ctx: ItemContext) => unknown;
};

/** One entry per function of VariablesImpl: a function added to the interface fails the type check until it has a gate. */
const GATES: Record<keyof VariablesImpl, Gate> = {
  buildStore: {
    id: 'build-store',
    family: 'sources',
    component: 'store/estate',
    rule: 'R5',
    run: (ctx) => `buildStore answers with ${callBuild(ctx, {}).variables.length} variables for no sources`,
  },
  weightInterval: {
    id: 'weight-interval',
    family: 'weights',
    component: 'store/weights',
    rule: 'R13',
    run: (ctx) => {
      const [lower, upper] = callInterval(ctx, 1, 2);
      return `weightInterval(1, 2) is [${lower}, ${upper}]`;
    },
  },
  plan: {
    id: 'plan',
    family: 'strength',
    component: 'planner/strength',
    rule: 'R7',
    run: (ctx) => {
      const [a, b] = names(ctx.rng, 2) as [string, string];
      const store = makeStore({
        vars: [
          { id: a, values: valueIds(2), shared: true },
          { id: b, values: valueIds(2), shared: true },
        ],
      });
      return `plan answers with ${callPlan(ctx, store, { seed: ctx.seed }).rows.length} rows`;
    },
  },
  coverage: {
    id: 'coverage',
    family: 'counter',
    component: 'planner/counter',
    rule: 'R12',
    run: (ctx) => {
      const [a, b] = names(ctx.rng, 2) as [string, string];
      const store = makeStore({
        vars: [
          { id: a, values: valueIds(2), shared: true },
          { id: b, values: valueIds(2), shared: true },
        ],
      });
      const counted = callCoverage(ctx, store, [], [{ variables: [a, b], strength: 2 }]);
      return `coverage counts ${String(counted.allowed)} allowed tuples`;
    },
  },
  validate: {
    id: 'validate',
    family: 'values',
    component: 'store/validate',
    rule: 'Values',
    run: (ctx) => `validate answers ok=${callValidate(ctx, baseFile(ctx).store).ok} for a valid store`,
  },
  quotes: {
    id: 'quotes',
    family: 'quotes',
    component: 'store/quotes',
    rule: 'R2',
    run: (ctx) => `quotes answers with ${callQuotes(ctx, baseFile(ctx).store, {}).errors.length} issues`,
  },
};

const FUNCTIONS = Object.keys(GATES) as Array<keyof VariablesImpl>;

const REACH_STEMS: readonly Stem[] = FUNCTIONS.map((name): Stem => {
  const gate = GATES[name];
  return {
    id: `reach.${gate.id}`,
    rules: [gate.rule],
    family: gate.family,
    component: gate.component,
    cause: `the adapter maps ${name} to a function of the product`,
    cases: [['mapped', 1, gate.run]],
  };
});

// ---------------------------------------------------------------------------------------------------------------
// A value id shared by axes of different kinds.

function axisOf(
  base: Base,
  kind: FileVariable['kind'],
  ids: string[],
  role: 'axis' | 'detail' = 'axis',
): number {
  const at = base.store.variables.length;
  base.store.variables.push({
    id: `extra_${at}`,
    title: `Extra ${at}`,
    kind,
    role,
    approved: true,
    values: ids.map((id): FileValue => ({ id, title: `The ${id} case` })),
  });
  return at;
}

const KIND_PAIRS = [
  ['behaviour', 'persona'],
  ['behaviour', 'data'],
  ['behaviour', 'task'],
  ['persona', 'data'],
  ['persona', 'task'],
  ['data', 'task'],
] as const;

const refusedAcross =
  (first: FileVariable['kind'], second: FileVariable['kind']) =>
  (ctx: ItemContext): void => {
    const b = defect(ctx, (base) => {
      axisOf(base, first, ['shared_case', 'first_only']);
      axisOf(base, second, ['shared_case', 'second_only']);
    });
    validateIssue(ctx, b.store, 'VARIABLES_AMBIGUOUS_VALUE', 'variables.6.values.0.id');
  };

const AMBIGUITY_STEM: Stem = {
  id: 'values.file.ambiguous-value',
  rules: ['Values'],
  family: 'values',
  component: 'store/validate',
  cause:
    'a value id sits in one axis only among the axes of kind behaviour, persona, data and task together, whatever their kinds',
  cases: [
    ...KIND_PAIRS.map(
      ([first, second]) => [`${first}-and-${second}`, 3, refusedAcross(first, second)] as const,
    ),
    [
      'ids-shared-with-a-stage-or-channel-axis-are-fine',
      3,
      (ctx) => {
        // The page binds the four kinds among themselves; a stage, channel or deviation axis is outside them.
        const b = defect(ctx, (base) => {
          axisOf(base, 'data', ['web', 'data_only']);
          axisOf(base, 'task', ['intake', 'task_only']);
        });
        validateOk(ctx, b.store);
      },
    ],
    [
      'none-in-axes-of-two-kinds-is-fine',
      3,
      (ctx) => {
        const b = defect(ctx, (base) => {
          axisOf(base, 'behaviour', ['none', 'greets']);
          axisOf(base, 'task', ['none', 'closes']);
        });
        validateOk(ctx, b.store);
      },
    ],
    [
      'a-detail-may-repeat-the-id-of-an-axis-of-another-kind',
      3,
      (ctx) => {
        const b = defect(ctx, (base) => {
          axisOf(base, 'task', ['shared_case', 'task_only']);
          axisOf(base, 'data', ['shared_case', 'data_only'], 'detail');
        });
        validateOk(ctx, b.store);
      },
    ],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// A pair of two values of one variable, and a constraint of one entry.

const PAIR_WORDINGS = [
  'a value cannot sit beside another value of its own variable',
  'never both, says the owner',
  'these two never occur together',
] as const;

const SAME_VARIABLE_STEM: Stem = {
  id: 'impossible.same-variable',
  rules: ['R7', 'Impossible'],
  family: 'impossible-pairs',
  component: 'planner/constraints',
  cause:
    'a pair of two values of one variable excludes nothing, whatever its wording, and a constraint of one entry still excludes its value',
  cases: [
    [
      'wording-does-not-decide',
      4,
      (ctx) => {
        const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
        const make = (extra: Array<[string, string, string, string]>, words?: string) => {
          const store = makeStore({
            vars: [
              { id: a, values: ['a0', 'a1', 'a2'], shared: true },
              { id: b, values: ['b0', 'b1'], shared: true },
              { id: c, values: ['c0', 'c1'], shared: true },
            ],
            impossible: [[b, 'b0', c, 'c1'], ...extra],
          });
          if (words !== undefined)
            for (const pair of store.impossible.slice(1))
              pair.provenance = [{ kind: 'owner', words, date: '2026-10-01' }];
          return store;
        };
        const plain = callPlan(ctx, make([]), { seed: ctx.seed });
        must(
          !plain.rows.some((r) => r.values[b] === 'b0' && r.values[c] === 'c1'),
          () => 'a row holds the pair b0, c1 that the store forbids',
        );
        for (const words of PAIR_WORDINGS) {
          const store = make(
            [
              [a, 'a0', a, 'a1'],
              [a, 'a2', a, 'a1'],
            ],
            words,
          );
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          must(
            jsonEqual(plan.rows, plain.rows),
            () =>
              `two pairs of two values of ${a}, worded "${words}", changed the plan; a row holds one value of a variable, so they exclude nothing`,
          );
          assertCovered(spaceOf(store), plan, []);
        }
      },
    ],
    [
      'one-entry-constraint-binds-beside-a-same-variable-pair',
      4,
      (ctx) => {
        const [a, b] = names(ctx.rng, 2) as [string, string];
        const store = makeStore({
          vars: [
            { id: a, values: ['p', 'q', 'r'], shared: true },
            { id: b, values: ['s', 't'], shared: true },
          ],
          forbids: [{ forbid: { [a]: 'q' }, approved: true }],
          impossible: [[a, 'p', a, 'r']],
        });
        const plan = callPlan(ctx, store, { seed: ctx.seed });
        const space = spaceOf(store);
        assertRowsSound(space, plan, []);
        assertCovered(space, plan, []);
        const fresh = newRows(plan);
        must(
          !fresh.some((r) => r.values[a] === 'q'),
          () => `a row holds ${a}=q, a value the one-entry constraint forbids`,
        );
        for (const value of ['p', 'r'])
          must(
            fresh.some((r) => r.values[a] === value),
            () => `no row holds ${a}=${value}; a pair of two values of one variable excludes neither`,
          );
      },
    ],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// The quote check on a store file with no `constraints` key.

const NOTES = 'agent/notes.md';
const NOTES_TEXT = 'Intro line.\nWhen the parcel is late, tell the customer.\nOutro line.\n';
const QUOTE_PATH = 'variables.0.values.0.provenance.0.quote';

function storeAbsentConstraints(ctx: ItemContext, quote: string, listed: boolean): FileStore {
  const { store } = baseFile(ctx);
  if (listed) store.constraints = [];
  else delete store.constraints;
  (variableOf(store, 0).values[0] as { provenance?: FileProvenance[] }).provenance = [
    { kind: 'quote', path: NOTES, quote },
  ];
  return store;
}

const FALSE_QUOTE = 'When the parcel is early, ignore the customer.';

const NO_CONSTRAINTS_STEM: Stem = {
  id: 'quotes.no-constraints',
  rules: ['Provenance'],
  family: 'quotes',
  component: 'store/quotes',
  cause: 'the quote check reads a store file with no constraints list as one with an empty list',
  cases: [
    [
      'true-quote-is-found',
      2,
      (ctx) => {
        const r = callQuotes(ctx, storeAbsentConstraints(ctx, 'When the parcel is late', false), {
          [NOTES]: NOTES_TEXT,
        });
        must(r.errors.length === 0, () => `a quote the file holds was reported: ${show(r.errors, 240)}`);
      },
    ],
    [
      'false-quote-is-reported',
      2,
      (ctx) => {
        const r = callQuotes(ctx, storeAbsentConstraints(ctx, FALSE_QUOTE, false), { [NOTES]: NOTES_TEXT });
        must(
          r.errors.length === 1 &&
            r.errors[0]?.code === 'VARIABLES_QUOTE_NOT_FOUND' &&
            r.errors[0]?.path === QUOTE_PATH,
          () =>
            `quotes reported ${show(r.errors, 240)}; expected the one VARIABLES_QUOTE_NOT_FOUND at ${QUOTE_PATH}`,
        );
      },
    ],
    [
      'absent-list-and-empty-list-agree',
      3,
      (ctx) => {
        const files = { [NOTES]: NOTES_TEXT };
        const absent = callQuotes(ctx, storeAbsentConstraints(ctx, FALSE_QUOTE, false), files);
        const empty = callQuotes(ctx, storeAbsentConstraints(ctx, FALSE_QUOTE, true), files);
        must(
          absent.errors.length > 0 && jsonEqual(absent.errors, empty.errors),
          () =>
            `a store with no constraints list gives ${show(absent.errors, 200)}; with an empty list ${show(empty.errors, 200)}`,
        );
      },
    ],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// The interval refuses what is outside its domain.

function refusesInterval(ctx: ItemContext, count: number, total: number): void {
  const f = need(ctx, 'weightInterval');
  const got = attempt(() => f(count, total));
  must(
    got.error !== undefined,
    () => `weightInterval(${count}, ${total}) returned ${show(got.value)} instead of throwing`,
  );
  const error = got.error as Error;
  must(
    error.name === 'RangeError',
    () => `weightInterval(${count}, ${total}) threw ${error.name}: ${error.message}; expected a RangeError`,
  );
}

const INTERVAL_REFUSES_STEM: Stem = {
  id: 'weights.interval-refuses',
  rules: ['R13'],
  family: 'weights',
  component: 'store/weights',
  cause: 'weightInterval raises a RangeError for a count or a total outside the domain of the interval',
  cases: [
    [
      'count-above-total',
      3,
      (ctx) => {
        const total = ctx.rng.int(1, 40);
        refusesInterval(ctx, total + ctx.rng.int(1, 20), total);
      },
    ],
    ['count-one-above-total', 3, (ctx) => refusesInterval(ctx, 4, 3)],
    ['negative-count', 3, (ctx) => refusesInterval(ctx, -ctx.rng.int(1, 9), ctx.rng.int(1, 40))],
    ['total-below-one', 3, (ctx) => refusesInterval(ctx, 0, 0)],
    ['fractional-count', 3, (ctx) => refusesInterval(ctx, ctx.rng.int(1, 8) + 0.5, 10)],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// The count over many rows, and a constraint that is not approved.

/** Eight shared variables of three values, the group of all of them at strength 2: 28 pairs of nine tuples. */
function manyRowsCase(ctx: ItemContext): { store: StoreDoc; ids: string[]; group: Group } {
  const ids = names(ctx.rng, 8) as string[];
  const store = makeStore({
    vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })),
  });
  return { store, ids, group: { variables: ids, strength: 2 } };
}

/** The rows of the case: `count` rows that never hold v0 in the first two variables together. */
function manyRows(ctx: ItemContext, ids: readonly string[], count: number, partial: boolean): Row[] {
  const rows: Row[] = [];
  while (rows.length < count) {
    const row: Row = {};
    for (const id of ids) {
      if (partial && ctx.rng.chance(0.3)) continue;
      row[id] = `v${ctx.rng.int(0, 2)}`;
    }
    if (row[ids[0] as string] === 'v0' && row[ids[1] as string] === 'v0') continue;
    rows.push(row);
  }
  return rows;
}

/** The distinct allowed tuples of the group and those the rows hold, counted by brute force over the rows. */
function countedBy(ids: readonly string[], rows: readonly Row[]): { allowed: number; covered: number } {
  const seen = new Set<string>();
  for (const row of rows) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = row[ids[i] as string];
        const b = row[ids[j] as string];
        if (a !== undefined && b !== undefined) seen.add(`${i}:${a}|${j}:${b}`);
      }
    }
  }
  return { allowed: (ids.length * (ids.length - 1) * 9) / 2, covered: seen.size };
}

const countsOver =
  (count: number, partial: boolean, repeat = 1) =>
  (ctx: ItemContext): void => {
    const { store, ids, group } = manyRowsCase(ctx);
    const base = manyRows(ctx, ids, Math.ceil(count / repeat), partial);
    const rows: Row[] = [];
    for (let k = 0; k < repeat; k += 1) for (const row of base) rows.push({ ...row });
    const want = countedBy(ids, rows);
    must(want.covered < want.allowed, 'the item left no tuple uncovered');
    const got = callCoverage(ctx, store, rows, [group]);
    must(
      BigInt(got.allowed) === BigInt(want.allowed),
      () => `${rows.length} rows: allowed is ${String(got.allowed)}; the exact count is ${want.allowed}`,
    );
    must(
      BigInt(got.covered) === BigInt(want.covered),
      () =>
        `${rows.length} rows: covered is ${String(got.covered)}; the rows hold ${want.covered} of the ${want.allowed} allowed tuples`,
    );
  };

const MANY_ROWS_STEM: Stem = {
  id: 'counter.many-rows',
  rules: ['R12'],
  family: 'counter',
  component: 'planner/counter',
  heavy: true,
  cause: 'the count of covered tuples is exact however many rows are given',
  cases: [
    ['twenty-thousand-full-rows', 4, countsOver(20_000, false)],
    ['twenty-thousand-partial-rows', 4, countsOver(20_000, true)],
    ['twenty-thousand-rows-repeating-a-few', 4, countsOver(20_000, false, 400)],
    ['sixty-thousand-full-rows', 5, countsOver(60_000, false)],
  ],
};

const FORBID_STORE = (ctx: ItemContext, approved: boolean | undefined, cells: number) => {
  const ids = names(ctx.rng, cells) as string[];
  const forbid: Row = Object.fromEntries(ids.map((id) => [id, 'x']));
  const store = makeStore({
    vars: ids.map((id) => ({ id, values: ['x', 'y'], shared: true })),
    forbids: [{ forbid, ...(approved === undefined ? {} : { approved }) }],
  });
  return { store, group: { variables: ids, strength: cells } as Group };
};

const allowedWith =
  (approved: boolean | undefined, cells: number, want: number) =>
  (ctx: ItemContext): void => {
    const { store, group } = FORBID_STORE(ctx, approved, cells);
    const got = callCoverage(ctx, store, [], [group]);
    must(
      BigInt(got.allowed) === BigInt(want),
      () =>
        `a forbid of ${cells} cells ${approved === false ? 'that is not approved' : approved === true ? 'that is approved' : 'with no approval flag'}: allowed is ${String(got.allowed)}, expected ${want}`,
    );
  };

const CONSTRAINT_APPROVAL_STEM: Stem = {
  id: 'counter.constraints',
  rules: ['R7', 'R12'],
  family: 'counter',
  component: 'planner/counter',
  cause: 'a constraint that is not approved excludes nothing from the allowed tuples, and an approved one does',
  cases: [
    ['unapproved-forbid-excludes-nothing', 3, allowedWith(false, 2, 4)],
    ['approved-forbid-excludes-its-pair', 3, allowedWith(true, 2, 3)],
    ['forbid-without-a-flag-is-approved', 3, allowedWith(undefined, 2, 3)],
    ['unapproved-three-cell-forbid-excludes-nothing', 4, allowedWith(false, 3, 8)],
    ['approved-three-cell-forbid-excludes-its-tuple', 4, allowedWith(true, 3, 7)],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// The quote check on a large file, and on a quote with an emoji.

const BIG_PATH = 'agent/handbook.md';

/** About `megabytes` megabytes of distinct lines, with `tail` as the last line. */
function bigFile(megabytes: number, tail: string): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = 0; size < megabytes * 1_000_000; i += 1) {
    const line = `Section ${i}: the desk answers case ${i * 7 + 3} within the agreed time and notes it.`;
    lines.push(line);
    size += line.length + 1;
  }
  lines.push(tail);
  return `${lines.join('\n')}\n`;
}

function quotedStore(ctx: ItemContext, path: string, quote: string): FileStore {
  const { store } = baseFile(ctx);
  (variableOf(store, 0).values[0] as { provenance?: FileProvenance[] }).provenance = [
    { kind: 'quote', path, quote },
  ];
  return store;
}

const reportsOne = (ctx: ItemContext, store: FileStore, files: Record<string, string>, what: string): void => {
  const r = callQuotes(ctx, store, files);
  must(
    r.errors.length === 1 &&
      r.errors[0]?.code === 'VARIABLES_QUOTE_NOT_FOUND' &&
      r.errors[0]?.path === QUOTE_PATH,
    () => `${what}: quotes reported ${show(r.errors, 240)}; expected the one VARIABLES_QUOTE_NOT_FOUND at ${QUOTE_PATH}`,
  );
};

const acceptsAll = (ctx: ItemContext, store: FileStore, files: Record<string, string>, what: string): void => {
  const r = callQuotes(ctx, store, files);
  must(r.errors.length === 0, () => `${what}: a quote the file holds was reported: ${show(r.errors, 240)}`);
};

const TAIL = 'When the parcel is late, tell the customer before the end of the day.';

const LARGE_FILE_STEM: Stem = {
  id: 'quotes.large-file',
  rules: ['R2'],
  family: 'quotes',
  component: 'store/quotes',
  heavy: true,
  cause: 'the quote check reads a file of any size to its end',
  cases: [
    [
      'wrong-quote-at-the-end-of-five-megabytes-is-reported',
      4,
      (ctx) => {
        const file = bigFile(5, TAIL);
        reportsOne(
          ctx,
          quotedStore(ctx, BIG_PATH, 'When the parcel is late, tell the customer after the end of the day.'),
          { [BIG_PATH]: file },
          'five megabytes',
        );
      },
    ],
    [
      'right-quote-at-the-end-of-five-megabytes-is-found',
      4,
      (ctx) => {
        const file = bigFile(5, TAIL);
        acceptsAll(ctx, quotedStore(ctx, BIG_PATH, TAIL), { [BIG_PATH]: file }, 'five megabytes');
      },
    ],
    [
      'wrong-quote-in-ten-megabytes-is-reported',
      5,
      (ctx) => {
        const file = bigFile(10, TAIL);
        reportsOne(
          ctx,
          quotedStore(ctx, BIG_PATH, 'When the parcel is early, tell the customer.'),
          { [BIG_PATH]: file },
          'ten megabytes',
        );
      },
    ],
  ],
};

const EMOJI_NOTES = 'agent/tone.md';
const EMOJI_TEXT = 'Intro line.\nClose the chat with a rocket \u{1F680} and a check ✅ for the customer.\nOutro line.\n';

const emojiCase =
  (quote: string, present: boolean) =>
  (ctx: ItemContext): void => {
    const store = quotedStore(ctx, EMOJI_NOTES, quote);
    const files = { [EMOJI_NOTES]: EMOJI_TEXT };
    if (present) acceptsAll(ctx, store, files, `the quote ${JSON.stringify(quote)}`);
    else reportsOne(ctx, store, files, `the quote ${JSON.stringify(quote)}`);
  };

const EMOJI_STEM: Stem = {
  id: 'quotes.emoji',
  rules: ['R2', 'Provenance'],
  family: 'quotes',
  component: 'store/quotes',
  cause: 'the quote check compares a quote that holds an emoji word for word, as it does any other quote',
  cases: [
    ['right-quote-with-a-rocket-is-found', 3, emojiCase('Close the chat with a rocket \u{1F680} and a check', true)],
    [
      'wrong-quote-with-a-rocket-is-reported',
      3,
      emojiCase('Close the chat with a rocket \u{1F680} and a cross', false),
    ],
    [
      'wrong-quote-with-a-check-mark-is-reported',
      3,
      emojiCase('a check ✅ for the agent', false),
    ],
    [
      'wrong-quote-with-the-other-emoji-is-reported',
      4,
      emojiCase('Close the chat with a rocket \u{1F680}\u{1F680} and a check', false),
    ],
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// A boundary that quotes a passage joins the rule of that passage.

const RULES_PATH = 'agent/rules.md';
const PASSAGE = 'When the order is late, offer a refund and log the case.';

type BoundaryAxis = { id: string; quote: string };

/** Three details of three values; the boundary of each quotes the passage named for it. */
function boundaryStore(axes: readonly BoundaryAxis[]): StoreDoc {
  const store = makeStore({
    vars: axes.map((axis) => ({ id: axis.id, values: ['lo', 'at', 'hi'] })),
  });
  axes.forEach((axis, i) => {
    (store.variables[i] as StoreDoc['variables'][number]).boundaries = [
      {
        holds: 'hi',
        fails: 'lo',
        edge: 'at',
        limit: 5 + i,
        comparison: 'gt',
        provenance: [{ kind: 'quote', path: RULES_PATH, quote: axis.quote }],
      },
    ];
  });
  return store;
}

const BOUNDARY_RULE_STEM: Stem = {
  id: 'plan.rules',
  rules: ['R6', 'Planning'],
  family: 'strength',
  component: 'planner/strength',
  cause: 'a boundary that quotes a passage belongs to the rule of that passage, so the plan covers the triples of that rule',
  cases: [
    [
      'boundary-quote-joins-its-rule',
      4,
      (ctx) => {
        const ids = names(ctx.rng, 3) as string[];
        const store = boundaryStore(ids.map((id) => ({ id, quote: PASSAGE })));
        const plan = callPlan(ctx, store, { seed: ctx.seed });
        const ruled = makeStore({
          vars: ids.map((id) => ({ id, values: ['lo', 'at', 'hi'] })),
          rules: [{ id: 'passage', variables: ids }],
        });
        const space = spaceOf(ruled);
        assertRowsSound(space, plan, []);
        assertCovered(space, plan, []);
      },
    ],
    [
      'quotes-with-other-spacing-are-one-passage',
      4,
      (ctx) => {
        const ids = names(ctx.rng, 3) as string[];
        const spaced = [PASSAGE, PASSAGE.replace(/ /g, '  '), ` ${PASSAGE.replace('late, offer', 'late,\noffer')} `];
        const store = boundaryStore(ids.map((id, i) => ({ id, quote: spaced[i] as string })));
        const plan = callPlan(ctx, store, { seed: ctx.seed });
        const ruled = makeStore({
          vars: ids.map((id) => ({ id, values: ['lo', 'at', 'hi'] })),
          rules: [{ id: 'passage', variables: ids }],
        });
        const space = spaceOf(ruled);
        assertRowsSound(space, plan, []);
        assertCovered(space, plan, []);
      },
    ],
  ],
};

export const AUDIT_STEMS: readonly Stem[] = [
  ...REACH_STEMS,
  AMBIGUITY_STEM,
  SAME_VARIABLE_STEM,
  NO_CONSTRAINTS_STEM,
  INTERVAL_REFUSES_STEM,
  MANY_ROWS_STEM,
  CONSTRAINT_APPROVAL_STEM,
  LARGE_FILE_STEM,
  EMOJI_STEM,
  BOUNDARY_RULE_STEM,
];
