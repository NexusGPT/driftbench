import { BANK_MIN_FAMILY, BANK_MIN_SIZE } from '../../../hardness';
import type { Ladder } from '../../../ladder';
import { containerItems } from './families/containers';
import { formatItems } from './families/formats';
import { hostileItems } from './families/hostile';
import { inventoryItems } from './families/inventory';
import { relationItems } from './families/relations';
import { schemaItems } from './families/schema';
import {
  compositionItems,
  constraintItems,
  pairItems,
  roleItems,
  scaleItems,
  semanticsItems,
  styleItems,
  transformItems,
} from './families/styles';
import { firstVersionItems } from './families/v1';
import { bankLadder } from './ladder';
import type { BankDeps, BankItem } from './types';

/** Every item of the map bank, in level order (a stable sort keeps each family's order). */
export function mapBank(): BankItem[] {
  const items = [
    ...firstVersionItems(),
    ...inventoryItems(),
    ...formatItems(),
    ...schemaItems(),
    ...containerItems(),
    ...hostileItems(),
    ...styleItems(),
    ...pairItems(),
    ...relationItems(),
    ...constraintItems(),
    ...transformItems(),
    ...compositionItems(),
    ...semanticsItems(),
    ...roleItems(),
    ...scaleItems(),
  ];
  return items.sort((a, b) => a.level - b.level);
}

/** The map validator under the hardness contract: the bank as a ladder of eight levels. */
export function mapBankLadder(deps: BankDeps = {}): Ladder {
  return bankLadder('map', mapBank(), deps);
}

/** The bank's shape against section 12.1: at least 300 items, no family under 20, every tier, unique ids. */
export function bankShape(items: readonly BankItem[]): string[] {
  const problems: string[] = [];
  if (items.length < BANK_MIN_SIZE)
    problems.push(`the bank holds ${items.length} items, under ${BANK_MIN_SIZE}`);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} is used twice`);
    ids.add(item.id);
  }
  const families = new Map<string, number>();
  for (const item of items) families.set(item.family, (families.get(item.family) ?? 0) + 1);
  for (const [family, count] of families) {
    if (count < BANK_MIN_FAMILY)
      problems.push(`the family ${family} holds ${count} items, under ${BANK_MIN_FAMILY}`);
  }
  for (const tier of [1, 2, 3, 4, 5])
    if (!items.some((item) => item.tier === tier)) problems.push(`no item of tier ${tier}`);
  return problems;
}

/** Items per family and tier, as the journal's bankByFamilyTier records them. */
export function bankByFamilyTier(items: readonly BankItem[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const item of items) {
    const tiers = out[item.family] ?? {};
    tiers[String(item.tier)] = (tiers[String(item.tier)] ?? 0) + 1;
    out[item.family] = tiers;
  }
  return out;
}
