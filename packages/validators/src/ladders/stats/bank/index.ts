import * as stats from '@driftbench/stats';
import type { Item, Measure } from '../../../ladder';
import type { StatsImpl } from '../reference';
import { analyticItems } from './analytic';
import { degenerateItems } from './degenerate';
import { attempt, BANK_LEVELS, type BankItem, type BankLevel, type ItemOutcome, itemRng } from './item';
import { referenceItems } from './reference';
import { reproducibilityItems } from './reproducibility';
import { roadmapItems } from './roadmap';
import { scaleItems, stabilityItems } from './scale';
import { simulationItems } from './simulation';

export { BANK_LEVELS, type BankItem, type BankLevel, type ItemOutcome, type Tier } from './item';

export type BankOptions = { s?: StatsImpl; extra?: BankItem[] };

/** Every item of the statistics bank, in ladder order. */
export function statsBank(root: string): BankItem[] {
  const items = [
    ...referenceItems(),
    ...degenerateItems(),
    ...reproducibilityItems(),
    ...analyticItems(),
    ...simulationItems(),
    ...scaleItems(),
    ...stabilityItems(),
    ...roadmapItems(root),
  ];
  const order = new Map<BankLevel, number>(BANK_LEVELS.map((level, i) => [level, i]));
  return items.sort((a, b) => (order.get(a.level) as number) - (order.get(b.level) as number));
}

/** Runs one item on one seed. A throw inside the item is a failing outcome naming the error. */
export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  s: StatsImpl = stats,
): Promise<ItemOutcome> {
  const rng = itemRng(seed, item.id);
  try {
    const outcome = await item.check({ seed, s, root, rng });
    return outcome;
  } catch (cause) {
    const error = attempt(() => {
      throw cause;
    }).error;
    return {
      pass: false,
      detail: `the item threw ${error?.name}: ${error?.message} (calling the statistics package from ${item.component})`,
    };
  }
}

/** The outcome of every item on one seed. */
export type BankRun = Map<string, ItemOutcome & { ms?: number }>;

/** Runs the items on one seed in this process (no protection against an endless loop: for tests). */
export async function runInProcess(
  items: readonly BankItem[],
  seed: number,
  root: string,
  s: StatsImpl,
): Promise<BankRun> {
  const out: BankRun = new Map();
  for (const item of items) {
    const began = performance.now();
    const outcome = await runItem(item, seed, root, s);
    out.set(item.id, { ...outcome, ms: Math.round(performance.now() - began) });
  }
  return out;
}

/** The measure of one level from a seed's run: passing over the level's items, the failing ones named. */
export function levelMeasure(items: readonly BankItem[], run: BankRun): Measure {
  const failing: Item[] = [];
  for (const item of items) {
    const outcome = run.get(item.id) ?? { pass: false, detail: 'the item was not run' };
    if (!outcome.pass) {
      failing.push({
        id: item.id,
        component: item.component,
        detail: `[${item.family}, tier ${item.tier}] ${outcome.detail}`,
      });
    }
  }
  return { value: items.length === 0 ? 1 : (items.length - failing.length) / items.length, items: failing };
}

/** One level of the ladder: every item of the sub-bank on the seed; the value is passing over total. */
export async function bankLevel(
  items: readonly BankItem[],
  seed: number,
  root: string,
  s: StatsImpl,
): Promise<Measure> {
  const failing: Item[] = [];
  for (const item of items) {
    const outcome = await runItem(item, seed, root, s);
    if (!outcome.pass) {
      failing.push({
        id: item.id,
        component: item.component,
        detail: `[${item.family}, tier ${item.tier}] ${outcome.detail}`,
      });
    }
  }
  return { value: items.length === 0 ? 1 : (items.length - failing.length) / items.length, items: failing };
}
