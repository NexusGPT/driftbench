import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { blindBank } from '../../src/ladders/variables/blind/index';
import { beginLexicon } from '../../src/ladders/variables/blind/lexicon';
import { runWitness } from '../../src/ladders/variables/blind/witness';
import type { Sources, VariablesImpl } from '../../src/ladders/variables/interface';
import { variablesImpl as empty } from '../variables/constant-empty';
import { referenceImpl } from './reference/index';

/**
 * Cheat 5 of the r4 audit (validators/variables/audit.md): the paired witness of `blind/witness.ts` gave the product the
 * same store and the same quote on every seed ("Where the customer writes", "northgate_desk", "w/file.md"), so an empty
 * implementation that answered those two fixtures scored 37 items on every seed, hidden seed included, with no component
 * made correct. The witness now draws its strings and its numbers from the item's own stream, and a fixed store is no answer.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const light = blindBank().filter((item) => item.family !== 'scale');

/** The cheat as the seat wrote it (pilot/cheat.ts, `witness-special`): the empty implementation plus the two witness fixtures. */
const witnessSpecial: Partial<VariablesImpl> = {
  ...empty,
  validate(value) {
    const store = value as { variables?: Array<{ title?: string; values?: Array<{ id?: string }> }> } | null;
    if (store?.variables?.[0]?.title === 'Where the customer writes') {
      if (!('agent' in (store as object)))
        return { ok: false, errors: [{ code: 'SCHEMA_INVALID_TYPE', path: 'agent' }] };
      const values = store.variables[0].values ?? [];
      if (values[0]?.id !== undefined && values[0].id === values[1]?.id)
        return { ok: false, errors: [{ code: 'VARIABLES_DUPLICATE', path: 'variables.0.values.1.id' }] };
    }
    return empty.validate(value);
  },
  quotes(store, files) {
    const entry = (
      store as {
        variables?: Array<{ values?: Array<{ provenance?: Array<{ path: string; quote: string }> }> }>;
      }
    ).variables?.[2]?.values?.[0]?.provenance?.[0];
    if (entry?.path === 'w/file.md') {
      const text = files[entry.path];
      if (text === undefined)
        return {
          errors: [{ code: 'VARIABLES_SOURCE_UNREADABLE', path: 'variables.2.values.0.provenance.0' }],
        };
      if (!text.includes(entry.quote))
        return { errors: [{ code: 'VARIABLES_QUOTE_NOT_FOUND', path: 'variables.2.values.0.provenance.0' }] };
    }
    return empty.quotes(store, files);
  },
};

describe('a product that answers the fixtures of the witness (cheat 5)', () => {
  it('scores no item on seeds 1 to 3', async () => {
    const passing: string[] = [];
    for (const seed of [1, 2, 3]) {
      for (const item of light) {
        const ctx = { seed, impl: witnessSpecial, root: ROOT, id: item.id, rng: itemRng(seed, item.id) };
        try {
          if ((await item.check(ctx)).pass) passing.push(`${seed}:${item.id}`);
        } catch {
          // an item that throws did not pass
        }
      }
    }
    expect(passing).toEqual([]);
  }, 600_000);
});

/** Every string and number a witness hands to the product, by function, recorded while the reference answers. */
async function fixtures(seed: number): Promise<Record<string, unknown>> {
  const seen: Record<string, unknown[]> = {};
  const note = (name: string, value: unknown) => {
    const list = seen[name] ?? [];
    list.push(value);
    seen[name] = list;
  };
  const recording: VariablesImpl = {
    ...referenceImpl,
    validate(value) {
      const store = value as {
        agent?: string;
        variables: Array<{ title: string; values: Array<{ id: string }> }>;
      };
      note('validate', [
        store.agent,
        store.variables.map((v) => v.title),
        store.variables[0]?.values.map((x) => x.id),
      ]);
      return referenceImpl.validate(value);
    },
    quotes(store, files) {
      const entry = (
        store as {
          variables: Array<{ values: Array<{ provenance?: Array<{ path: string; quote: string }> }> }>;
        }
      ).variables[2]?.values[0]?.provenance?.[0];
      note('quotes', [entry?.path, entry?.quote, files]);
      return referenceImpl.quotes(store, files);
    },
    weightInterval(count, total) {
      note('weightInterval', [count, total]);
      return referenceImpl.weightInterval(count, total);
    },
    buildStore(sources: Sources) {
      note(
        'buildStore',
        sources.estate?.rules.flatMap((r) =>
          r.tools.map((t) => [t.tool, t.field, t.values.map((v) => v.id)]),
        ),
      );
      return referenceImpl.buildStore(sources);
    },
    coverage(store, rows, groups, options) {
      note('coverage', [store.variables.map((v) => v.id), rows.length, groups]);
      return referenceImpl.coverage(store, rows, groups, options);
    },
    plan(store, options) {
      note('plan', [store.variables.map((v) => v.id), store.impossible]);
      return referenceImpl.plan(store, options);
    },
  };
  const ctx = { seed, impl: recording, root: ROOT, id: 'zz.witness', rng: itemRng(seed, 'zz.witness') };
  beginLexicon(ctx);
  for (const key of ['validate', 'quotes', 'weightInterval', 'buildStore', 'coverage', 'plan'] as const) {
    const failed = await runWitness(ctx, key);
    expect(failed?.outcome.detail, `the reference fails the witness of ${key}`).toBeUndefined();
  }
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, JSON.stringify(v)]));
}

describe('what a witness hands to the product', () => {
  it('differs on every seed, function by function', async () => {
    // One seed at a time: the lexicon of the running item is current for the whole process.
    const bySeed: Array<Record<string, unknown>> = [];
    for (const seed of [1, 2, 3, 4]) bySeed.push(await fixtures(seed));
    for (const name of Object.keys(bySeed[0] as object)) {
      const texts = bySeed.map((f) => f[name] as string);
      expect(new Set(texts).size, `the witness of ${name} hands over the same fixtures on two seeds`).toBe(
        texts.length,
      );
    }
  }, 120_000);

  it('hands over no fixed string of the old fixtures', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const text = JSON.stringify(Object.values(await fixtures(seed)));
      for (const fixed of [
        'Where the customer writes',
        'northgate_desk',
        'w/file.md',
        'witness_tool',
        'The witness sentence',
      ]) {
        expect(text.includes(fixed), `${fixed} on seed ${seed}`).toBe(false);
      }
    }
  }, 120_000);
});

/**
 * Review of #1545 (codex-review-stats): the witness of weightInterval had its zero-success lower bound read as `|lo - wilson| <
 * 1e-6`, where it was `|lo| < 1e-9`. A product that returns 1e-7 for no success passed the witness at the new tolerance, and
 * with it the existing five-of-ten item, whose own check only asks for a share near a half. The lower end of the Wilson interval
 * of no success is zero, so the exact test stays beside the tighter upper end.
 */
describe('a weightInterval that is off by 1e-7 at no success', () => {
  const lenientAtZero: Partial<VariablesImpl> = {
    ...referenceImpl,
    weightInterval(count, total) {
      const [lo, hi] = referenceImpl.weightInterval(count, total);
      return count === 0 ? [lo + 1e-7, hi] : [lo, hi];
    },
  };
  const FIVE = 'blind.weights.interval.five-of-ten';

  it('fails the witness of weightInterval, and the correct reference passes it', async () => {
    const ctx = (impl: Partial<VariablesImpl>) => ({
      seed: 1,
      impl,
      root: ROOT,
      id: 'zz.lower',
      rng: itemRng(1, 'zz.lower'),
    });
    expect((await runWitness(ctx(referenceImpl), 'weightInterval'))?.outcome.detail).toBeUndefined();
    expect((await runWitness(ctx(lenientAtZero), 'weightInterval'))?.outcome.pass).toBe(false);
  });

  it('fails the five-of-ten item, whose own check passes it; the reference passes the item', async () => {
    const item = light.find((entry) => entry.id === FIVE);
    if (!item) throw new Error(FIVE);
    const run = (impl: Partial<VariablesImpl>) =>
      item.check({ seed: 2, impl, root: ROOT, id: item.id, rng: itemRng(2, item.id) });
    expect((await run(referenceImpl)).pass).toBe(true);
    const outcome = await run(lenientAtZero);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/passed the item and then failed its witness/);
  });
});
