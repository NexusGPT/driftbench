import { type BankEntry, bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import { runItem } from './run';
import { type BankDeps, type BankItem, LEVELS } from './types';

/**
 * The ladder version of the bank (docs/validators.md section 12.5); version 1 was the seven-level ladder.
 * Version 3 adds the cutter level: the pointer reader cuts the prompts the bank renders.
 */
export const MAP_LADDER_VERSION = 3;

/**
 * The ladder of a bank: one level per entry of LEVELS, each the sub-bank of its items with threshold 1. Each
 * level returns its whole bank (`bankMeasure`), so `--items` lists every item with its family and tier and
 * the value is the share of the level's items that pass on the seed. The run stops at the first failing level.
 */
export function bankLadder(component: string, items: readonly BankItem[], deps: BankDeps = {}): Ladder {
  return defineLadder({
    component,
    version: MAP_LADDER_VERSION,
    levels: LEVELS.map((level, index) => {
      const own = items.filter((item) => item.level === index + 1);
      return {
        id: level.id,
        name: level.name,
        metric: `items passing / items of the level (${own.length}): ${level.what}`,
        threshold: 1,
        compute: async ({ seed }) => {
          const entries: BankEntry[] = [];
          for (const item of own) {
            const outcome = await runItem(item, seed, deps);
            entries.push({
              id: item.id,
              component: item.component,
              family: item.family,
              tier: item.tier,
              cause: item.cause,
              pass: outcome.pass,
              detail: `[${item.family}, tier ${item.tier}] ${item.title}: ${outcome.detail}. Fix: ${item.cause}`,
            });
          }
          return bankMeasure(entries, component);
        },
      };
    }),
  });
}
