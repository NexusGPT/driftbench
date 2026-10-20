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
  must,
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

const witnesses: Record<Name, (ctx: ItemContext) => void> = {
  validate(ctx) {
    const good = baseFile(ctx);
    validateOk(ctx, good.store, 'the witness store');
    const twice = baseFile(ctx);
    variableOf(twice.store, 0).values[1] = copy(variableOf(twice.store, 0).values[0]) as never;
    validateIssue(ctx, twice.store, 'VARIABLES_DUPLICATE', 'variables.0.values.1.id');
    const bare = baseFile(ctx);
    delete (bare.store as Partial<typeof bare.store>).agent;
    validateIssue(ctx, bare.store, 'SCHEMA_INVALID_TYPE', 'agent');
  },
  quotes(ctx) {
    const sentence = 'The witness sentence sits in its file.';
    const withQuote = (quote: string) => {
      const { store } = baseFile(ctx);
      (variableOf(store, 2).values[0] as { provenance?: unknown[] }).provenance = [
        { kind: 'quote', path: 'w/file.md', quote },
      ];
      return store;
    };
    const files = { 'w/file.md': `Intro.\n${sentence}\nOutro.` };
    must(
      callQuotes(ctx, withQuote(sentence), files).errors.length === 0,
      () => 'the witness quote in its file was reported',
    );
    const missing = callQuotes(ctx, withQuote('A sentence the file does not hold.'), files).errors;
    must(
      missing.length === 1 && missing[0]?.code === 'VARIABLES_QUOTE_NOT_FOUND',
      () => 'the witness quote missing from its file was not reported',
    );
    const gone = callQuotes(ctx, withQuote(sentence), {}).errors;
    must(
      gone.length === 1 && gone[0]?.code === 'VARIABLES_SOURCE_UNREADABLE',
      () => 'the witness quote with no file was not reported',
    );
  },
  plan(ctx) {
    const ids = names(ctx.rng, 3);
    const store = makeStore({
      vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })),
      impossible: [[ids[0] as string, 'v0', ids[1] as string, 'v0']],
    });
    const plan = callPlan(ctx, store, { seed: ctx.seed });
    const space = spaceOf(store);
    assertRowsSound(space, plan, []);
    assertCovered(space, plan);
    must(plan.rows.length >= 3, () => 'the witness plan has fewer than three rows for three binary axes');
  },
  coverage(ctx) {
    const ids = names(ctx.rng, 3);
    const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
    const group = [{ variables: ids, strength: 2 }];
    const none = callCoverage(ctx, store, [], group);
    must(
      BigInt(none.allowed) === 12n && BigInt(none.covered) === 0n,
      () => `the witness count is ${String(none.allowed)} and ${String(none.covered)}; expected 12 and 0`,
    );
    const row: Row = Object.fromEntries(ids.map((id) => [id, 'v0']));
    const one = callCoverage(ctx, store, [row], group);
    must(BigInt(one.covered) === 3n, () => `one row holds ${String(one.covered)} pairs; expected 3`);
  },
  weightInterval(ctx) {
    const [lo, hi] = callInterval(ctx, 0, 10);
    must(
      Math.abs(lo) < 1e-9 && Math.abs(hi - 0.2775) < 1e-3,
      () => `the witness interval of 0 of 10 is [${lo}, ${hi}]`,
    );
    const [a, b] = callInterval(ctx, 50, 100);
    must(
      a > 0.39 && a < 0.41 && b > 0.59 && b < 0.61,
      () => `the witness interval of 50 of 100 is [${a}, ${b}]`,
    );
  },
  buildStore(ctx) {
    const tool: ToolSpec = { tool: 'witness_tool', field: 'queue', values: ['alpha', 'beta'] };
    const d = discover(ctx, [tool]);
    const variable = d.store.variables.find((v) => v.id === d.ids[0]);
    must(
      variable?.values.length === 2,
      () => 'the witness store does not hold the two values of the tool field',
    );
  },
};

/** Wraps the check of an item so that the functions it called must also pass their witness. */
export function withWitness(item: BankItem): BankItem {
  return {
    ...item,
    check: async (ctx) => {
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
      if (!outcome.pass) return outcome;
      for (const key of used) {
        const witnessed = await outcomeOf(() => {
          witnesses[key]({ ...ctx, id: `${ctx.id}.witness.${key}` });
          return undefined;
        });
        if (!witnessed.pass)
          return {
            pass: false,
            detail: `${key} passed the item and then failed its witness: ${witnessed.detail}`,
          };
      }
      return outcome;
    },
  };
}
