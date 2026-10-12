import type { BankEntry, Item, Measure } from '../../../ladder';
import { causeOf } from './causes';

/**
 * The bank frame of the estate validator (docs/validators.md section 12). A bank is a list of items; an item
 * is one capability the estate loop must have, with an id, a family, a difficulty tier from 1 to 5, the level
 * it belongs to, and the one component it points at. A family holds the seeded generator that builds the
 * input of all its items for a seed and the exact oracle that judges each of them; a family runs once per
 * seed, so its items share one generated estate and each judges only its own part.
 *
 * A level is a sub-bank: it passes on a seed when every item of the level passes on it. The bank score is
 * the share of items that pass on every seed asked.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;

export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  level: number;
  component: string;
  /** What the item asks of the component, in words. */
  title: string;
  /** The one change that would make the item pass (section 12.4); items sharing a cause count once. */
  cause: string;
};

export type ItemResult = { pass: boolean; detail: string };

export type Family = {
  id: string;
  level: number;
  /** The component most items point at; an item may name its own. */
  component: string;
  items: readonly BankItem[];
  /** Builds the family's input for the seed and judges every item; an item missing from the map failed. */
  evaluate(seed: number): Promise<Map<string, ItemResult>>;
  /**
   * The family's input does not depend on the seed (a committed fictional fixture): it is judged once per
   * process and that result holds for every seed.
   */
  seedFree?: boolean;
};

export type ItemSpec = {
  key: string;
  tier: Tier;
  title: string;
  component?: string;
  /** The one change that would make the item pass; else the cause table of bank/causes.ts names it. */
  cause?: string;
};

/** The items of a family from short specs: id `<family>.<key>`. */
export function itemsOf(
  family: string,
  level: number,
  component: string,
  specs: readonly ItemSpec[],
): BankItem[] {
  const seen = new Set<string>();
  return specs.map((spec) => {
    const id = `${family}.${spec.key}`;
    if (seen.has(id)) throw new Error(`the bank repeats the item ${id}`);
    seen.add(id);
    return {
      id,
      family,
      tier: spec.tier,
      level,
      component: spec.component ?? component,
      title: spec.title,
      cause: spec.cause ?? causeOf(id, spec.title),
    };
  });
}

const cache = new Map<string, Promise<Map<string, ItemResult>>>();

/** A family's results on a seed, computed once per process. A family that throws fails every item. */
export function familyResults(family: Family, seed: number): Promise<Map<string, ItemResult>> {
  const key = family.seedFree ? `${family.id}:*` : `${family.id}:${seed}`;
  let known = cache.get(key);
  if (!known) {
    known = family.evaluate(seed).catch(
      (cause) =>
        new Map(
          family.items.map((item) => [
            item.id,
            {
              pass: false,
              detail: `the family threw: ${cause instanceof Error ? cause.message : String(cause)}`,
            },
          ]),
        ),
    );
    cache.set(key, known);
  }
  return known;
}

/** Forgets every computed result: tests that plant a fault in a component call it. */
export function clearBankCache(): void {
  cache.clear();
}

/**
 * The measure of a level on a seed: items passing over items, the failing ones named with their family, tier
 * and cause, and the whole bank, so the common frame can list it and count its causes.
 */
export async function levelMeasure(families: readonly Family[], seed: number): Promise<Measure> {
  const items: Item[] = [];
  const bank: BankEntry[] = [];
  for (const family of families) {
    const results = await familyResults(family, seed);
    for (const item of family.items) {
      const result = results.get(item.id);
      const pass = result?.pass === true;
      const detail = `[${item.family}, tier ${item.tier}] ${item.title}: ${result?.detail ?? 'no result'}`;
      const named = {
        id: item.id,
        component: item.component,
        family: item.family,
        tier: item.tier,
        cause: item.cause,
      };
      bank.push({ ...named, pass, detail });
      if (!pass) items.push({ ...named, detail });
    }
  }
  const passed = bank.filter((entry) => entry.pass).length;
  return { value: bank.length === 0 ? 0 : passed / bank.length, items, bank };
}

export type BankScore = {
  size: number;
  passing: number;
  score: number;
  /** Per item: passes on every seed, or the first seed it failed on and why. */
  items: Array<BankItem & { pass: boolean; failedOn?: string; detail?: string }>;
};

/**
 * The bank score over seeds: an item passes when it passes on every seed. A seed is not asked of an item
 * that already failed, so a failing item costs one seed.
 */
export async function bankScore(
  families: readonly Family[],
  seeds: ReadonlyArray<{ seed: number; label: string }>,
): Promise<BankScore> {
  const items: BankScore['items'] = [];
  for (const family of families) {
    const open = new Map(family.items.map((item) => [item.id, item]));
    const failed = new Map<string, { label: string; detail: string }>();
    for (const { seed, label } of seeds) {
      if (open.size === 0) break;
      const results = await familyResults(family, seed);
      for (const [id] of open) {
        const result = results.get(id);
        if (!result?.pass) {
          failed.set(id, { label, detail: result?.detail ?? 'no result' });
          open.delete(id);
        }
      }
    }
    for (const item of family.items) {
      const failure = failed.get(item.id);
      items.push(
        failure
          ? { ...item, pass: false, failedOn: failure.label, detail: failure.detail }
          : { ...item, pass: true },
      );
    }
  }
  const passing = items.filter((item) => item.pass).length;
  return { size: items.length, passing, score: items.length === 0 ? 0 : passing / items.length, items };
}

/** Bank size per family and per tier. */
export function bankShape(families: readonly Family[]): {
  families: Record<string, number>;
  tiers: Record<string, number>;
  levels: Record<string, number>;
  size: number;
} {
  const families_: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  const levels: Record<string, number> = {};
  let size = 0;
  for (const family of families) {
    for (const item of family.items) {
      families_[item.family] = (families_[item.family] ?? 0) + 1;
      tiers[String(item.tier)] = (tiers[String(item.tier)] ?? 0) + 1;
      levels[String(item.level)] = (levels[String(item.level)] ?? 0) + 1;
      size += 1;
    }
  }
  return { families: families_, tiers, levels, size };
}
