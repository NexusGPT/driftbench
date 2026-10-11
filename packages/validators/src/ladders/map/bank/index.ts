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
