import type { BankItem } from '../bank/item';
import { AUDIT_STEMS } from './families/audit';
import { BOUNDARIES_STEMS } from './families/boundaries';
import { BUDGET_STEMS } from './families/budget';
import { COUNTER_STEMS } from './families/counter';
import { IMPOSSIBLE_STEMS } from './families/impossible';
import { PROPERTY_STEMS } from './families/property';
import { QUOTES_STEMS } from './families/quotes';
import { SCALE_STEMS } from './families/scale';
import { SEEDS_STEMS } from './families/seeds';
import { SOURCES_STEMS } from './families/sources';
import { STRENGTH_STEMS } from './families/strength';
import { VALUES_STEMS } from './families/values';
import { WEIGHTS_STEMS } from './families/weights';
import { BLIND_FAMILIES, expand, type Stem } from './kit';
import { withWitness } from './witness';

export { BLIND_FAMILIES } from './kit';

/**
 * The blind variables bank: items written from docs/variables.md (Programmatic readers and planning),
 * docs/validators.md and the neutral interface alone, by a lane that never read the store, the readers or the
 * planner. Every item takes the implementation through ItemContext.impl, like the items of the main bank, so the
 * ladder can run them beside it with one line (`...blindBank()` in variablesBank). The bank is not wired into the
 * ladder here: wiring it changes the item count of every committed journal row, a maintainer commit (12.3).
 */
export const BLIND_STEMS: readonly Stem[] = [
  ...SOURCES_STEMS,
  ...QUOTES_STEMS,
  ...VALUES_STEMS,
  ...BOUNDARIES_STEMS,
  ...IMPOSSIBLE_STEMS,
  ...WEIGHTS_STEMS,
  ...STRENGTH_STEMS,
  ...SEEDS_STEMS,
  ...BUDGET_STEMS,
  ...COUNTER_STEMS,
  ...SCALE_STEMS,
  ...AUDIT_STEMS,
  ...PROPERTY_STEMS,
];

/** Every item of the blind bank, in family order. */
export function blindBank(): BankItem[] {
  return expand(BLIND_STEMS).map(withWitness);
}

export type BlindCount = { total: number; byFamily: Record<string, number>; byTier: Record<number, number> };

/** The size of the bank: the numbers of the acceptance (300 items, no family under 20, every tier). */
export function blindCount(items: readonly BankItem[] = blindBank()): BlindCount {
  const byFamily: Record<string, number> = Object.fromEntries(BLIND_FAMILIES.map((f) => [f, 0]));
  const byTier: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const item of items) {
    byFamily[item.family] = (byFamily[item.family] ?? 0) + 1;
    byTier[item.tier] = (byTier[item.tier] ?? 0) + 1;
  }
  return { total: items.length, byFamily, byTier };
}
