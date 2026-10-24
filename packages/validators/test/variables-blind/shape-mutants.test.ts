import { describe, expect, it } from 'vitest';
import type { BankItem } from '../../src/ladders/variables/bank/item';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { blindBank } from '../../src/ladders/variables/blind/index';
import type { Sources, StoreDoc, VariablesImpl } from '../../src/ladders/variables/interface';
import { referenceImpl } from './reference/index';

/**
 * One planted reader per new reader shape: a reader that handles every other shape and lacks only this one. Each must
 * fail exactly the item of its shape and no other item of the source and boundary families, on seeds 1 to 3. An item
 * that only a generic mutant fails would not prove its shape is a cause of its own (review of #1367).
 */

const KINDS = 'blind.sources.condition.kinds.';
const NUMERALS = 'blind.sources.condition.numerals.';

type Shape = { name: string; item: string; text: RegExp; how: 'drop' | 'split' };

const SHAPES: Shape[] = [
  {
    name: 'open at both ends',
    item: `${KINDS}range-with-both-ends-open`,
    text: /is more than \S+ and fewer than /,
    how: 'drop',
  },
  {
    name: 'closed at one end',
    item: `${KINDS}range-with-one-end-closed`,
    text: /is at least \S+ but under /,
    how: 'drop',
  },
  {
    name: 'negative lower limit',
    item: `${KINDS}range-with-a-negative-lower-limit`,
    text: /(between|from) -\d/,
    how: 'drop',
  },
  {
    name: 'decimal limits',
    item: `${KINDS}range-with-decimal-limits`,
    text: /(between|from) \d+\.5 (and|to) \d+\.5/,
    how: 'drop',
  },
  {
    name: 'neither nor',
    item: `${KINDS}membership-written-as-neither-nor`,
    text: /\bis neither\b/,
    how: 'drop',
  },
  { name: 'either or', item: `${KINDS}membership-written-as-either-or`, text: /\bis either\b/, how: 'drop' },
  {
    name: 'fact and negation',
    item: `${KINDS}a-fact-and-its-negation-are-one-variable`,
    text: /\bis not\b/,
    how: 'split',
  },
  { name: 'k suffix', item: `${NUMERALS}thousands-written-with-k`, text: /\b\d+k euros/, how: 'drop' },
  {
    name: 'million word',
    item: `${NUMERALS}millions-written-with-a-word`,
    text: / million euros/,
    how: 'drop',
  },
];

/** The reference with one shape missing. */
function without(shape: Shape): Partial<VariablesImpl> {
  return {
    ...referenceImpl,
    buildStore(sources: Sources): StoreDoc {
      const estate = sources.estate;
      if (!estate) return referenceImpl.buildStore(sources);
      if (shape.how === 'drop') {
        // The reader does not read a clause of this shape at all.
        const rules = estate.rules.map((r) => ({
          ...r,
          conditions: r.conditions.filter((c) => !shape.text.test(c.text)),
        }));
        return referenceImpl.buildStore({ ...sources, estate: { ...estate, rules } });
      }
      // The reader reads the negation as a fact of its own: the rule that holds it gets a second true-or-false variable.
      const store = structuredClone(referenceImpl.buildStore(sources));
      const negated = new Set(
        estate.rules.filter((r) => r.conditions.some((c) => shape.text.test(c.text))).map((r) => r.id),
      );
      for (const rule of store.rules) {
        if (!negated.has(rule.id)) continue;
        rule.variables = rule.variables.map((id) => {
          const v = store.variables.find((x) => x.id === id);
          if (!v?.values.some((x) => x.sample === true)) return id;
          const copy = structuredClone(v);
          copy.id = `${v.id}~negated`;
          store.variables.push(copy);
          return copy.id;
        });
      }
      return store;
    },
  };
}

const items = blindBank().filter((i) => i.family === 'sources' || i.family === 'boundaries');

async function failing(
  list: readonly BankItem[],
  seed: number,
  impl: Partial<VariablesImpl>,
): Promise<string[]> {
  const out: string[] = [];
  for (const item of list) {
    let pass = false;
    try {
      pass = (
        await item.check({ seed, impl, root: '/nonexistent', id: item.id, rng: itemRng(seed, item.id) })
      ).pass;
    } catch {
      pass = false;
    }
    if (!pass) out.push(item.id);
  }
  return out;
}

describe('a reader that lacks one shape fails that shape and nothing else', () => {
  it('the reference passes every source and boundary item on seeds 1 to 3', async () => {
    for (const seed of [1, 2, 3])
      expect(await failing(items, seed, referenceImpl), `seed ${seed}`).toEqual([]);
  }, 300_000);

  for (const shape of SHAPES) {
    it(shape.name, async () => {
      expect(
        items.some((i) => i.id === shape.item),
        shape.item,
      ).toBe(true);
      for (const seed of [1, 2, 3]) {
        expect(await failing(items, seed, without(shape)), `seed ${seed}`).toEqual([shape.item]);
      }
    }, 300_000);
  }
});
