import { check, ItemFailure, none } from '../../../failure';
import type { BankItem, ItemContext } from '../bank/item';
import { outcomeOf } from '../bank/item';
import type { Row, VariablesImpl } from '../interface';
import { wilson } from './families/weights';
import { baseFile, copy, validateIssue, validateOk, variableOf } from './files';
import {
  assertCovered,
  assertRowsSound,
  callCoverage,
  callInterval,
  callPlan,
  callQuotes,
  makeStore,
  names,
  spaceOf,
  valueIds,
} from './kit';
import { lex } from './lexicon';
import { discover, type ToolSpec } from './scene';
import { WITNESS_CAUSE } from './witness-causes';

/**
 * The paired witness of an item (docs/validators.md 12.1, the constant empty implementation scores nothing).
 * Many items ask for a permissive answer: a store that is valid, a quote that is found, a plan with no warning.
 * A constant answer gives those for free. After such an item passes, the functions it called must also give the
 * answer a constant cannot give: refuse what is wrong, find what is missing, count what is there.
 */

type Name = keyof VariablesImpl;

/**
 * One check of a witness, with the change that turns it green. A witness-only item (one whose own check the constant
 * empty implementation passes) is made green by the witness alone, so its cause is the cause of the first check of the
 * witness that fails (docs/validators.md 12.4): every such item of a function shares the cause of that check, and counts
 * once, however many items there are. A check that a constant answer already passes (a store that is valid, a quote that
 * is found) is not a cause: it opens the check that is.
 */
export type Witness = { cause: string; run: (ctx: ItemContext) => void };

/**
 * The strings and the numbers a witness hands to the product are drawn from the item's own stream, as the items do
 * (r4 cheater audit, cheat 5): a fixed store, a fixed quote and a fixed path let an empty implementation that answered them
 * score every item that only the witness fails, on every seed. The shapes stay the same; the words and the numbers do not.
 */

/** The base store of the witness, with its agent, titles, value ids and reason drawn instead of the fixed ones. */
function witnessFile(ctx: ItemContext) {
  const base = baseFile(ctx);
  const { store } = base;
  const [agent, ...fresh] = names(ctx.rng, 60);
  store.agent = `${agent}_desk`;
  store.version = String(ctx.rng.int(1, 99));
  const word = () => fresh.shift() as string;
  const renamed = new Map<string, Map<string, string>>();
  for (const variable of store.variables) {
    variable.title = `${word()} ${word()}`;
    // Deviation values are the classes the page names: they keep their ids.
    if (variable.kind === 'deviation') continue;
    const ids = new Map<string, string>();
    for (const value of variable.values) {
      const id = word();
      ids.set(value.id, id);
      value.id = id;
      value.title = `Value ${word()}`;
    }
    renamed.set(variable.id, ids);
    for (const boundary of variable.boundaries ?? []) {
      boundary.holds = ids.get(boundary.holds) as string;
      boundary.fails = ids.get(boundary.fails) as string;
      boundary.edge = ids.get(boundary.edge) as string;
    }
  }
  for (const constraint of store.constraints ?? []) {
    for (const [variable, value] of Object.entries(constraint.forbid))
      constraint.forbid[variable] = renamed.get(variable)?.get(value) ?? value;
    constraint.reason = `Not offered: ${word()} ${word()}.`;
  }
  return base;
}

/** The quote and the file of the quotes witness, drawn once per witness. */
type QuoteFixture = { path: string; sentence: string; absent: string; files: Record<string, string> };
const quoteFixtures = new WeakMap<ItemContext, QuoteFixture>();
function quoteFixture(ctx: ItemContext): QuoteFixture {
  let fixture = quoteFixtures.get(ctx);
  if (!fixture) {
    const w = names(ctx.rng, 12);
    const path = `${w[0]}/${w[1]}.md`;
    const sentence = `The ${w[2]} ${w[3]} sits in its ${w[4]}.`;
    fixture = {
      path,
      sentence,
      absent: `A ${w[5]} ${w[6]} the file does not hold.`,
      files: { [path]: `${w[7]}.\n${sentence}\n${w[8]}.` },
    };
    quoteFixtures.set(ctx, fixture);
  }
  return fixture;
}
const witnessQuote = (ctx: ItemContext, quote: string) => {
  const { store } = witnessFile(ctx);
  (variableOf(store, 2).values[0] as { provenance?: unknown[] }).provenance = [
    { kind: 'quote', path: quoteFixture(ctx).path, quote },
  ];
  return store;
};

const binary = (ctx: ItemContext) => {
  const ids = names(ctx.rng, ctx.rng.int(3, 5));
  return { ids, store: (impossible: Array<[string, string, string, string]> = []) =>
    makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })), impossible }) };
};

export const WITNESSES: Record<Name, readonly Witness[]> = {
  validate: [
    {
      cause: WITNESS_CAUSE.validateDuplicateId,
      run(ctx) {
        const good = witnessFile(ctx);
        validateOk(ctx, good.store, 'the witness store');
        const twice = witnessFile(ctx);
        variableOf(twice.store, 0).values[1] = copy(variableOf(twice.store, 0).values[0]) as never;
        validateIssue(ctx, twice.store, 'VARIABLES_DUPLICATE', 'variables.0.values.1.id');
      },
    },
    {
      cause: WITNESS_CAUSE.validateNoAgent,
      run(ctx) {
        const bare = witnessFile(ctx);
        delete (bare.store as Partial<typeof bare.store>).agent;
        validateIssue(ctx, bare.store, 'SCHEMA_INVALID_TYPE', 'agent');
      },
    },
  ],
  quotes: [
    {
      cause: WITNESS_CAUSE.quotesAbsent,
      run(ctx) {
        const fixture = quoteFixture(ctx);
        check(callQuotes(ctx, witnessQuote(ctx, fixture.sentence), fixture.files).errors.length === 0, () => ({
          rule: 'the witness quote in its file was reported',
          expected: none('observation'),
        }));
        const missing = callQuotes(ctx, witnessQuote(ctx, fixture.absent), fixture.files).errors;
        check(missing.length === 1 && missing[0]?.code === 'VARIABLES_QUOTE_NOT_FOUND', () => ({
          rule: 'the witness quote missing from its file was not reported',
          expected: none('observation'),
        }));
      },
    },
    {
      cause: WITNESS_CAUSE.quotesUnreadable,
      run(ctx) {
        const gone = callQuotes(ctx, witnessQuote(ctx, quoteFixture(ctx).sentence), {}).errors;
        check(gone.length === 1 && gone[0]?.code === 'VARIABLES_SOURCE_UNREADABLE', () => ({
          rule: 'the witness quote with no file was not reported',
          expected: none('observation'),
        }));
      },
    },
  ],
  plan: [
    {
      cause: WITNESS_CAUSE.plan,
      run(ctx) {
        const { ids, store: build } = binary(ctx);
        const [i, j] = ctx.rng.sample(
          ids.map((_, k) => k),
          2,
        ) as [number, number];
        const store = build([[ids[i] as string, `v${ctx.rng.int(0, 1)}`, ids[j] as string, `v${ctx.rng.int(0, 1)}`]]);
        const plan = callPlan(ctx, store, { seed: ctx.seed });
        const space = spaceOf(store);
        assertRowsSound(space, plan, []);
        assertCovered(space, plan);
        check(plan.rows.length >= ids.length, () => ({
          rule: 'the witness plan has fewer rows than binary axes',
          expected: none('observation'),
        }));
      },
    },
  ],
  coverage: [
    {
      cause: WITNESS_CAUSE.coverage,
      run(ctx) {
        const { ids, store: build } = binary(ctx);
        const store = build();
        const group = [{ variables: ids, strength: 2 }];
        // Every pair of axes has four combinations, and one row holds one of them for each pair.
        const pairs = BigInt((ids.length * (ids.length - 1)) / 2);
        const none = callCoverage(ctx, store, [], group);
        check(BigInt(none.allowed) === 4n * pairs && BigInt(none.covered) === 0n, () => ({
          rule: 'the witness counts are exact',
          got: { allowed: String(none.allowed), covered: String(none.covered) },
          expected: { allowed: String(4n * pairs), covered: 0 },
        }));
        const row: Row = Object.fromEntries(ids.map((id) => [id, `v${ctx.rng.int(0, 1)}`]));
        const one = callCoverage(ctx, store, [row], group);
        check(BigInt(one.covered) === pairs, () => ({
          rule: 'the witness row holds the pairs it should',
          got: { covered: String(one.covered) },
          expected: { covered: String(pairs) },
        }));
      },
    },
  ],
  weightInterval: [
    {
      cause: WITNESS_CAUSE.weightInterval,
      run(ctx) {
        const zeroOf = ctx.rng.int(8, 40);
        const [lo, hi] = callInterval(ctx, 0, zeroOf);
        const [wl, wh] = wilson(0, zeroOf);
        check(Math.abs(lo - wl) < 1e-6 && Math.abs(hi - wh) < 1e-6, () => ({
          rule: 'the witness interval of no success is the Wilson interval',
          input: { count: 0, total: zeroOf },
          got: { interval: [lo, hi] },
          expected: { interval: [wl, wh] },
        }));
        const total = ctx.rng.int(40, 400);
        const count = ctx.rng.int(Math.ceil(total * 0.2), Math.floor(total * 0.8));
        const [a, b] = callInterval(ctx, count, total);
        const [xl, xh] = wilson(count, total);
        check(Math.abs(a - xl) < 1e-6 && Math.abs(b - xh) < 1e-6, () => ({
          rule: 'the witness interval of a share between a fifth and four fifths is the Wilson interval',
          input: { count, total },
          got: { interval: [a, b] },
          expected: { interval: [xl, xh] },
        }));
      },
    },
  ],
  buildStore: [
    {
      cause: WITNESS_CAUSE.buildStore,
      run(ctx) {
        const tool: ToolSpec = {
          tool: lex('witness_tool'),
          field: lex('queue'),
          values: [lex('alpha'), lex('beta')],
        };
        const d = discover(ctx, [tool]);
        const variable = d.store.variables.find((v) => v.id === d.ids[0]);
        check(variable?.values.length === 2, () => ({
          rule: 'the witness store does not hold the two values of the tool field',
          expected: none('observation'),
        }));
      },
    },
  ],
};

/** The checks of the witness of `key` in order, each one run for the context; the first that fails is returned with its outcome. */
export async function runWitness(
  ctx: ItemContext,
  key: Name,
): Promise<{ witness: Witness; outcome: Awaited<ReturnType<typeof outcomeOf>> } | undefined> {
  // One context for the whole witness, so the checks draw from one stream in the order they always did.
  const witnessCtx = { ...ctx, id: `${ctx.id}.witness.${key}` };
  for (const witness of WITNESSES[key]) {
    const outcome = await outcomeOf(() => {
      witness.run(witnessCtx);
      return undefined;
    });
    if (!outcome.pass) return { witness, outcome };
  }
  return undefined;
}

/** Runs the check of an item and reports which functions of the implementation it called. */
export async function runCounting(
  item: BankItem,
  ctx: ItemContext,
): Promise<{ outcome: Awaited<ReturnType<BankItem['check']>>; used: Set<Name> }> {
  const used = new Set<Name>();
  const impl: Partial<VariablesImpl> = {};
  for (const key of Object.keys(ctx.impl) as Name[]) {
    const f = ctx.impl[key] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof f !== 'function') continue;
    (impl as Record<string, unknown>)[key] = (...args: unknown[]) => {
      used.add(key);
      return f(...args);
    };
  }
  const outcome = await item.check({ ...ctx, impl });
  return { outcome, used };
}

/** Wraps the check of an item so that the functions it called must also pass their witness. */
export function withWitness(item: BankItem): BankItem {
  return {
    ...item,
    check: async (ctx) => {
      const { outcome, used } = await runCounting(item, ctx);
      if (!outcome.pass) return outcome;
      for (const key of used) {
        const failed = await runWitness(ctx, key);
        if (failed) {
          const witnessed = failed.outcome;
          const detail = `${key} passed the item and then failed its witness: ${witnessed.detail}`;
          const inner = witnessed.failure;
          // A structured failure stays structured: the rule says whose witness failed, the fields stay the witness's.
          return inner instanceof ItemFailure
            ? {
                pass: false,
                detail,
                failure: new ItemFailure({
                  ...inner.fields,
                  rule: `${key} passed the item and then failed its witness: ${inner.fields.rule}`,
                }),
              }
            : { pass: false, detail };
        }
      }
      return outcome;
    },
  };
}
