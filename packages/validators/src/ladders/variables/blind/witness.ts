import { check, ItemFailure, none } from '../../../failure';
import type { BankItem, ItemContext } from '../bank/item';
import { outcomeOf } from '../bank/item';
import type { Row, VariablesImpl } from '../interface';
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
import { discover, type ToolSpec } from './scene';

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

const sentence = 'The witness sentence sits in its file.';
const witnessQuote = (ctx: ItemContext, quote: string) => {
  const { store } = baseFile(ctx);
  (variableOf(store, 2).values[0] as { provenance?: unknown[] }).provenance = [
    { kind: 'quote', path: 'w/file.md', quote },
  ];
  return store;
};
const witnessFiles = { 'w/file.md': `Intro.\n${sentence}\nOutro.` };

export const WITNESSES: Record<Name, readonly Witness[]> = {
  validate: [
    {
      cause: 'validate refuses a store in which two values of one variable share an id, at the second value',
      run(ctx) {
        const good = baseFile(ctx);
        validateOk(ctx, good.store, 'the witness store');
        const twice = baseFile(ctx);
        variableOf(twice.store, 0).values[1] = copy(variableOf(twice.store, 0).values[0]) as never;
        validateIssue(ctx, twice.store, 'VARIABLES_DUPLICATE', 'variables.0.values.1.id');
      },
    },
    {
      cause: 'validate refuses a store that has no agent',
      run(ctx) {
        const bare = baseFile(ctx);
        delete (bare.store as Partial<typeof bare.store>).agent;
        validateIssue(ctx, bare.store, 'SCHEMA_INVALID_TYPE', 'agent');
      },
    },
  ],
  quotes: [
    {
      cause: 'quotes reports a quote that the file it names does not hold',
      run(ctx) {
        check(callQuotes(ctx, witnessQuote(ctx, sentence), witnessFiles).errors.length === 0, () => ({
          rule: 'the witness quote in its file was reported',
          expected: none('observation'),
        }));
        const missing = callQuotes(
          ctx,
          witnessQuote(ctx, 'A sentence the file does not hold.'),
          witnessFiles,
        ).errors;
        check(missing.length === 1 && missing[0]?.code === 'VARIABLES_QUOTE_NOT_FOUND', () => ({
          rule: 'the witness quote missing from its file was not reported',
          expected: none('observation'),
        }));
      },
    },
    {
      cause: 'quotes reports a quote whose file cannot be read',
      run(ctx) {
        const gone = callQuotes(ctx, witnessQuote(ctx, sentence), {}).errors;
        check(gone.length === 1 && gone[0]?.code === 'VARIABLES_SOURCE_UNREADABLE', () => ({
          rule: 'the witness quote with no file was not reported',
          expected: none('observation'),
        }));
      },
    },
  ],
  plan: [
    {
      cause: 'plan holds every required pair of three binary axes in rows that avoid the impossible pair',
      run(ctx) {
        const ids = names(ctx.rng, 3);
        const store = makeStore({
          vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })),
          impossible: [[ids[0] as string, 'v0', ids[1] as string, 'v0']],
        });
        const plan = callPlan(ctx, store, { seed: ctx.seed });
        const space = spaceOf(store);
        assertRowsSound(space, plan, []);
        assertCovered(space, plan);
        check(plan.rows.length >= 3, () => ({
          rule: 'the witness plan has fewer than three rows for three binary axes',
          expected: none('observation'),
        }));
      },
    },
  ],
  coverage: [
    {
      cause: 'coverage counts the allowed tuples of a group, and the ones the rows hold, exactly',
      run(ctx) {
        const ids = names(ctx.rng, 3);
        const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
        const group = [{ variables: ids, strength: 2 }];
        const none = callCoverage(ctx, store, [], group);
        check(BigInt(none.allowed) === 12n && BigInt(none.covered) === 0n, () => ({
          rule: 'the witness counts are exact',
          got: { allowed: String(none.allowed), covered: String(none.covered) },
          expected: { allowed: 12, covered: 0 },
        }));
        const row: Row = Object.fromEntries(ids.map((id) => [id, 'v0']));
        const one = callCoverage(ctx, store, [row], group);
        check(BigInt(one.covered) === 3n, () => ({
          rule: 'the witness row holds the pairs it should',
          got: { covered: String(one.covered) },
          expected: { covered: 3 },
        }));
      },
    },
  ],
  weightInterval: [
    {
      cause: 'weightInterval returns the Wilson score interval of a count and a total',
      run(ctx) {
        const [lo, hi] = callInterval(ctx, 0, 10);
        check(Math.abs(lo) < 1e-9 && Math.abs(hi - 0.2775) < 1e-3, () => ({
          rule: 'the witness interval of N of N is [{}, {}]',
          got: { details: [lo, hi] },
          expected: none('observation'),
        }));
        const [a, b] = callInterval(ctx, 50, 100);
        check(a > 0.39 && a < 0.41 && b > 0.59 && b < 0.61, () => ({
          rule: 'the witness interval of N of N is [{}, {}]',
          got: { details: [a, b] },
          expected: none('observation'),
        }));
      },
    },
  ],
  buildStore: [
    {
      cause: 'buildStore builds one variable, with a value for each quote, from the values of a tool field',
      run(ctx) {
        const tool: ToolSpec = { tool: 'witness_tool', field: 'queue', values: ['alpha', 'beta'] };
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
