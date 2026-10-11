import { defineLadder, type Item, type Ladder } from '../../../ladder';
import { runItem } from './run';
import { type BankDeps, type BankItem, LEVELS } from './types';

/**
 * The ladder of a bank: one level per entry of LEVELS, each the sub-bank of its items with threshold 1. A
 * level's value is the share of its items that pass on the seed; the failing items are named with their
 * family, tier and the oracle's reason. The run stops at the first failing level.
 */
export function bankLadder(component: string, items: readonly BankItem[], deps: BankDeps = {}): Ladder {
  return defineLadder({
    component,
    levels: LEVELS.map((level, index) => {
      const own = items.filter((item) => item.level === index + 1);
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items of the level (${own.length}): ${level.what}`,
        threshold: 1,
        compute: async ({ seed }) => {
          const failing: Item[] = [];
          for (const item of own) {
            const outcome = await runItem(item, seed, deps);
            if (!outcome.pass) {
              failing.push({
                id: item.id,
                component: item.component,
                detail: `[${item.family}, tier ${item.tier}] ${item.title}: ${outcome.detail}`,
              });
            }
          }
          return { value: own.length === 0 ? 1 : (own.length - failing.length) / own.length, items: failing };
        },
      };
    }),
  });
}
