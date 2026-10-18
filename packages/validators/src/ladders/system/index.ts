import { defineLadder, type Ladder } from '../../ladder';
import { BANK_LEVELS, type BankItem, levelMeasure, systemBank } from './bank/index';

export * from './bank/index';
export { CHECK_COMPONENTS, SYSTEM_COMPONENTS } from './components';
export { type EffectState, PLANTED_TARGET, runEffect, runPassed } from './effect';
export {
  FAMILY_TARGET,
  FAULT_FAMILY,
  type FamilyFault,
  loadFamily,
  OPERATORS,
  type Operator,
} from './family';

/** The version of the system ladder: version 2 is the item bank of docs/validators.md section 12. */
export const SYSTEM_LADDER_VERSION = 5;

export type SystemLadderOptions = {
  /** Replaces the bank: tests run a few items, or plant a failing one. */
  bank?: BankItem[];
};

/**
 * The system validator (docs/validators.md sections 5 and 12): does the whole chain report the truth. Each
 * level is a sub-bank of items with threshold 1: every item of the level passes on the seed, or the level
 * fails and names its failing items, each with its family, tier and the one component it points at. The
 * run stops at the first failing level. Levels, in order of the cost of diagnosis: records, fault reach,
 * precision, drift class, run fields, recovery, variance, version drift, replay, command line, scale.
 */
export function systemLadder(options: SystemLadderOptions = {}): Ladder {
  const bank = options.bank ?? systemBank();
  return defineLadder({
    component: 'system',
    version: SYSTEM_LADDER_VERSION,
    levels: BANK_LEVELS.map((level) => {
      const items = bank.filter((item) => item.level === level.level);
      const families = [...new Set(items.map((item) => item.family))].join(', ');
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items, ${items.length} items (${families})`,
        threshold: 1,
        compute: ({ seed, root }) => levelMeasure(items, seed, root),
      };
    }),
  });
}
