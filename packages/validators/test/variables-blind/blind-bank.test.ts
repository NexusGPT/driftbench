import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BankItem, ItemContext } from '../../src/ladders/variables/bank/item';
import { COMPONENTS, FAMILIES, levelOf } from '../../src/ladders/variables/bank/manifest/types';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { CAUSES } from '../../src/ladders/variables/blind/causes';
import { BLIND_FAMILIES, BLIND_STEMS, blindBank, blindCount } from '../../src/ladders/variables/blind/index';
import type { VariablesImpl } from '../../src/ladders/variables/interface';
import { MUTANTS } from './mutants';
import { referenceImpl } from './reference/index';

/**
 * The checks of the blind variables bank (docs/validators.md 12.1 and 12.7):
 *   1. its size: at least 300 items, no family under 20, every tier;
 *   2. the reference, written from docs/variables.md alone, passes every item on several seeds (the items can
 *      be passed by a product that follows the page);
 *   3. the bank loses at least one item on every planted mutant of the reference (the items can fail).
 */

const items = blindBank();
const light = items.filter((i) => i.family !== 'scale');

function contextFor(item: BankItem, seed: number, impl: Partial<VariablesImpl>): ItemContext {
  return { seed, impl, root: '/nonexistent', id: item.id, rng: itemRng(seed, item.id) };
}

type Verdict = { id: string; detail: string };

async function failing(
  list: readonly BankItem[],
  seed: number,
  impl: Partial<VariablesImpl>,
): Promise<Verdict[]> {
  const out: Verdict[] = [];
  for (const item of list) {
    let pass = false;
    let detail = '';
    try {
      const r = await item.check(contextFor(item, seed, impl));
      pass = r.pass;
      detail = r.detail;
    } catch (error) {
      detail = `threw ${(error as Error).message}`;
    }
    if (!pass) out.push({ id: item.id, detail: detail.slice(0, 300) });
  }
  return out;
}

const text = (bad: Verdict[]): string[] => bad.map((v) => `${v.id}: ${v.detail}`);

/** The items some mutant made fail: an item no mutant ever fails could be passing for nothing. */
const killed = new Set<string>();

describe('the blind variables bank', () => {
  it('has at least 300 items, no family under 20 and every tier', () => {
    const count = blindCount(items);
    expect(count.total).toBeGreaterThanOrEqual(300);
    for (const family of BLIND_FAMILIES)
      expect(count.byFamily[family], `family ${family}`).toBeGreaterThanOrEqual(20);
    for (const tier of [1, 2, 3, 4, 5]) expect(count.byTier[tier], `tier ${tier}`).toBeGreaterThan(0);
  });

  it('covers the eleven families of the row and no other', () => {
    expect([...BLIND_FAMILIES].sort()).toEqual(
      [
        'sources',
        'quotes',
        'values',
        'boundaries',
        'impossible-pairs',
        'weights',
        'strength',
        'seed-rows',
        'budget-order',
        'counter',
        'scale',
      ].sort(),
    );
    for (const family of BLIND_FAMILIES) expect(FAMILIES).toContain(family);
    expect(new Set(items.map((i) => i.family))).toEqual(new Set(BLIND_FAMILIES));
  });

  it('gives every item a unique id, a known component, a cause and the level of its family', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of items) {
      expect(Object.keys(COMPONENTS), item.id).toContain(item.component);
      expect(item.cause.length, item.id).toBeGreaterThan(20);
      expect(item.level, item.id).toBe(levelOf(item.family as (typeof FAMILIES)[number], item.component));
      expect([1, 2, 3, 4, 5], item.id).toContain(item.tier);
    }
  });

  it('cites only rules that docs/variables.md holds, in the row of its family', () => {
    const doc = readFileSync(new URL('../../../../docs/variables.md', import.meta.url), 'utf8');
    const rows = new Map<string, string[]>();
    for (const m of doc.matchAll(/^\| ([a-z-]+) \| ([^|]+) \|/gm))
      rows.set(
        m[1] as string,
        (m[2] as string).split(',').map((x) => x.trim()),
      );
    const sections = ['Provenance', 'Limits', 'Values', 'Boundaries', 'Impossible', 'Approval'];
    for (const stem of BLIND_STEMS) {
      const row = rows.get(stem.family);
      expect(row, `no row for ${stem.family} in Rules by bank family`).toBeTruthy();
      expect(stem.rules.length, `${stem.id} cites no rule`).toBeGreaterThan(0);
      for (const rule of stem.rules) {
        expect(row, `${stem.id} cites ${rule}, outside the row of ${stem.family}`).toContain(rule);
        if (/^R\d+$/.test(rule))
          expect(doc, `${stem.id} cites ${rule}, which the page lacks`).toContain(`**${rule}:`);
        else expect(sections, `${stem.id} cites ${rule}, which is no section of the page`).toContain(rule);
      }
    }
  });

  it('gives every item a cause of its own kind, with none missing and none left over', () => {
    const stemIds = new Set(BLIND_STEMS.map((s) => s.id));
    for (const id of Object.keys(CAUSES))
      expect(stemIds, `causes for a stem that does not exist: ${id}`).toContain(id);
    for (const stem of BLIND_STEMS) {
      const keys = stem.cases.map((c) => c[0]);
      const causes = CAUSES[stem.id] ?? {};
      for (const key of keys) expect(causes[key], `${stem.id}.${key} has no cause`).toBeTruthy();
      for (const key of Object.keys(causes))
        expect(keys, `${stem.id} has a cause for a case that does not exist: ${key}`).toContain(key);
    }
    expect(new Set(items.map((i) => i.cause)).size).toBeGreaterThanOrEqual(100);
  });

  it('is passed by a reference written from the page, on three seeds', async () => {
    for (const seed of [1, 2, 3]) {
      const bad = await failing(light, seed, referenceImpl);
      expect(text(bad), `seed ${seed}`).toEqual([]);
    }
  }, 600_000);

  it('is passed by the reference on the scale items', async () => {
    const bad = await failing(
      items.filter((i) => i.family === 'scale'),
      1,
      referenceImpl,
    );
    expect(text(bad)).toEqual([]);
  }, 900_000);

  it('fails every item when the implementation provides nothing', async () => {
    const bad = await failing(
      items.filter((i) => i.family !== 'scale'),
      1,
      {},
    );
    expect(bad.length).toBe(light.length);
  }, 120_000);

  describe('loses at least one item on every planted mutant', () => {
    for (const mutant of MUTANTS) {
      it(mutant.name, async () => {
        const { impl, reset } = mutant.make(referenceImpl);
        try {
          const list = mutant.only
            ? items.filter((i) => mutant.only?.some((part) => i.id.endsWith(part)))
            : items.filter((i) => mutant.families.includes(i.family));
          expect(list.length).toBeGreaterThan(0);
          const bad = await failing(list, 1, impl);
          for (const v of bad) killed.add(v.id);
          expect(bad.length, `the bank did not notice: ${mutant.name}`).toBeGreaterThan(0);
        } finally {
          reset?.();
        }
      }, 240_000);
    }
  });

  it('has no item that every mutant leaves passing', () => {
    // Runs after the mutants. When the mutants were filtered out of the run there is nothing to judge.
    if (killed.size === 0) return;
    const alive = items.filter((i) => !killed.has(i.id)).map((i) => i.id);
    expect(alive, 'items that no mutant makes fail').toEqual([]);
  });
});
