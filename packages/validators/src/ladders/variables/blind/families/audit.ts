import type { ItemContext } from '../../bank/item';
import type { FileProvenance, FileStore, FileValue, FileVariable, VariablesImpl } from '../../interface';
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

export const AUDIT_STEMS: readonly Stem[] = [
  ...REACH_STEMS,
  AMBIGUITY_STEM,
  SAME_VARIABLE_STEM,
  NO_CONSTRAINTS_STEM,
];
