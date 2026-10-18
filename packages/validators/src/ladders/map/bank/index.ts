import { BANK_MIN_FAMILY, BANK_MIN_SIZE } from '../../../hardness';
import type { Ladder } from '../../../ladder';
import { adversarialItems } from './families/adversarial';
import { containerItems } from './families/containers';
import { cutterItems } from './families/cutter';
import { cutterAuditItems } from './families/cutter-audit';
import { formatItems } from './families/formats';
import { hostileItems } from './families/hostile';
import { inventoryItems } from './families/inventory';
import { plumbingItems } from './families/plumbing';
import { relationItems } from './families/relations';
import { schemaItems } from './families/schema';
import { spaceItems } from './families/space';
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

/**
 * Causes no product page needs (validators/map/NEEDS.md). Their items are kept and can be run, but they
 * count toward no score, forecast or cause: mapBank leaves them out, mapQuarantine lists them.
 */
export const QUARANTINED_CAUSES: Readonly<Record<string, string>> = {
  'tools:whole-long-quote':
    'no page needs a quote over 1000 characters: docs/generating.md asks for quotes of 4 to 400 characters, and the proposal format caps one at 1000 (MAX_QUOTE_LENGTH)',
  'inventory:whole-long-quote':
    'no page needs a quote over 1000 characters: docs/generating.md asks for quotes of 4 to 400 characters, and the proposal format caps one at 1000 (MAX_QUOTE_LENGTH)',
};

/** Items quarantined by id, with the reason (validators/map/NEEDS.md). */
export const QUARANTINED_ITEMS: Readonly<Record<string, string>> = {};

const quarantined = (item: BankItem) => item.cause in QUARANTINED_CAUSES || item.id in QUARANTINED_ITEMS;

/** Why an item is quarantined, or undefined when it counts. */
export function quarantineReason(item: BankItem): string | undefined {
  return QUARANTINED_CAUSES[item.cause] ?? QUARANTINED_ITEMS[item.id];
}

/** Every item of the map bank that a product page needs, in level order. */
export function mapBank(): BankItem[] {
  return allItems().filter((item) => !quarantined(item));
}

/** The items quarantined by QUARANTINED_CAUSES. */
export function mapQuarantine(): BankItem[] {
  return allItems().filter(quarantined);
}

/** Every item written for the map, in level order (a stable sort keeps each family's order). */
function allItems(): BankItem[] {
  const items = [
    ...firstVersionItems(),
    ...inventoryItems(),
    ...formatItems(),
    ...schemaItems(),
    ...containerItems(),
    ...hostileItems(),
    ...adversarialItems(),
    ...styleItems(),
    ...pairItems(),
    ...relationItems(),
    ...constraintItems(),
    ...spaceItems(),
    ...plumbingItems(),
    ...transformItems(),
    ...compositionItems(),
    ...semanticsItems(),
    ...roleItems(),
    ...scaleItems(),
    ...cutterItems(),
    ...cutterAuditItems(),
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

/** The distinct causes among the items that fail (section 12.4): items sharing a cause count once. */
export function distinctCauses(items: readonly BankItem[], failing: Iterable<string>): string[] {
  const ids = new Set(failing);
  return [...new Set(items.filter((item) => ids.has(item.id)).map((item) => item.cause))].sort();
}
