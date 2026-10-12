import type { Ladder } from '../../ladder';
import { mapBankLadder } from './bank';
import type { BankDeps } from './bank/types';

export { mapBank, mapBankLadder } from './bank';
export * from './first';

/**
 * The map validator under the hardness contract (docs/validators.md section 12): the bank of items as a
 * ladder of eight levels. The first ladder of section 2 is `mapLadderV1`; its seven levels are items of the bank.
 */
export function mapLadder(deps: BankDeps = {}): Ladder {
  return mapBankLadder(deps);
}
