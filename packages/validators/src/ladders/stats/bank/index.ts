import { bankMeasure, type Item, type Measure } from '../../../ladder';
import type { StatsImpl } from '../reference';
import { analyticItems } from './analytic';
import { degenerateItems } from './degenerate';
import { designBoundItems, edgeItems, ruleItems } from './edges';
import { exactItems } from './exact';
import { branchItems } from './exact-branches';
import { capabilityItems } from './exact-capabilities';
import { clopperAlphaItems } from './exact-clopper-alpha';
import { defectItems } from './exact-defects';
import { logAlphaItems } from './exact-log-alpha';
import { userCapabilityItems } from './exact-user-capabilities';
import { attempt, BANK_LEVELS, type BankItem, type BankLevel, type ItemOutcome, itemRng } from './item';
import { newcapItems } from './newcaps';
import { productItems } from './product';
import { rateItems } from './rates';
import { referenceItems } from './reference';
import { reproducibilityItems } from './reproducibility';
import { roadmapItems } from './roadmap';
import { scaleItems, stabilityItems } from './scale';
import { simulationItems } from './simulation';
import { sourceGuardItems } from './source-guards';
import { weightsItems } from './weights';

export { BANK_LEVELS, type BankItem, type BankLevel, type ItemOutcome, type Tier } from './item';

export type BankOptions = { s?: StatsImpl; extra?: BankItem[] };

/**
 * The one change that would make an item pass, when the item does not name it. Conservative: a function's
 * input checks are one cause, a roadmap method with all its generated items is one cause (add it, correctly).
 */
export function causeOf(item: BankItem): string {
  if (item.cause) return item.cause;
  const [head, fn = '', name = ''] = item.id.split('.');
  if (head === 'reference') return `${fn}.${name} differs from the scipy and numpy reference values`;
  if (head === 'degenerate') {
    if (item.family === 'degenerate-single-equal')
      return `${fn} gives a wrong answer on one value or all-equal values`;
    if (
      name.startsWith('domain-') &&
      /special\.ts|drift\.ts$/.test(item.component) &&
      !/must throw/.test(name)
    )
      return `${fn} does not return the scipy limit at the edge of its domain`;
    return `${fn} accepts a degenerate input without a RangeError naming the argument`;
  }
  if (
    head === 'roadmap' ||
    head === 'roadmap-degenerate' ||
    head === 'roadmap-scale' ||
    head === 'roadmap-coverage' ||
    head === 'roadmap-purity'
  )
    return `${fn} is missing from @agent-nexus/driftbench-stats`;
  if (head === 'analytic' && fn === 'allocation' && name.startsWith('neyman-optimal'))
    return 'neymanAllocation rounds to an allocation whose variance is above the best integer allocation';
  if (head === 'stability' && fn.startsWith('components-shift'))
    return 'varianceComponents loses precision on values with a large common offset';
  return item.id;
}

/** Every item of the statistics bank, in ladder order. */
export function statsBank(root: string): BankItem[] {
  const items: BankItem[] = [
    ...referenceItems(),
    ...degenerateItems(),
    ...reproducibilityItems(),
    ...analyticItems(),
    ...exactItems(),
    ...branchItems(),
    ...sourceGuardItems(),
    ...defectItems(),
    ...logAlphaItems(),
    ...clopperAlphaItems(),
    ...newcapItems(root),
    ...capabilityItems(),
    ...userCapabilityItems(),
    ...edgeItems(root),
    ...designBoundItems(),
    ...ruleItems(),
    ...productItems(),
    ...simulationItems(),
    ...rateItems(),
    ...scaleItems(),
    ...stabilityItems(),
    ...roadmapItems(root),
    ...weightsItems(),
  ];
  const order = new Map<BankLevel, number>(BANK_LEVELS.map((level, i) => [level, i]));
  return (
    items
      // After the need check (validators/stats/NEEDS.md) a handful of roadmap methods remain: their cases and
      // generated items form one family. The planned capabilities share the level and keep their own family.
      .map((item) => ({
        ...item,
        cause: causeOf(item),
        ...(item.level === 'roadmap' && item.id.startsWith('roadmap') ? { family: 'missing-method' } : {}),
      }))
      .sort((a, b) => (order.get(a.level) as number) - (order.get(b.level) as number))
  );
}

/**
 * What the bank child gives an item run besides the package: the frame's mark of the calls so far, and the first
 * aliased result among the calls since a mark (docs/validators.md section 12.9, "Aliased results").
 */
export type Watch = {
  mark(): number;
  aliased(since: number): string | undefined;
  /** Switches the strict arguments of the frame on for an item that declares a purity check, and off after it. */
  strict(on: boolean): void;
};

/**
 * Runs one item on one seed. A throw inside the item is a failing outcome naming the error. With a watch, an item
 * that passed fails when a confined run reports that a result it returned has changed since, whatever the item
 * concluded: the item reads the results as data and cannot see that on its own.
 */
export async function runItem(
  item: BankItem,
  seed: number,
  root: string,
  s?: StatsImpl,
  watch?: Watch,
): Promise<ItemOutcome> {
  const rng = itemRng(seed, item.id);
  // The package itself only when no replacement is given (tests): never loaded by the bank child, which is given the frame.
  const given = s ?? ((await import('@agent-nexus/driftbench-stats')) as StatsImpl);
  const since = watch?.mark() ?? 0;
  // An item that declares a purity check gets strict arguments from the frame; every other item gets none.
  watch?.strict(item.purity === true);
  try {
    const outcome = await item.check({ seed, s: given, root, rng });
    const moved = outcome.pass ? watch?.aliased(since) : undefined;
    return moved
      ? { pass: false, detail: `the package returned a result that changed later: ${moved}` }
      : outcome;
  } catch (cause) {
    const error = attempt(() => {
      throw cause;
    }).error;
    return {
      pass: false,
      detail: `the item threw ${error?.name}: ${error?.message} (calling the statistics package from ${item.component})`,
    };
  } finally {
    watch?.strict(false);
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
  return bankMeasure(
    items.map((item) => {
      const outcome = run.get(item.id) ?? { pass: false, detail: 'the item was not run' };
      return {
        id: item.id,
        component: item.component,
        family: item.family,
        tier: item.tier,
        ...(item.cause ? { cause: item.cause } : {}),
        pass: outcome.pass,
        ...(outcome.pass
          ? {}
          : { detail: `[${item.family}, tier ${item.tier}, cause: ${item.cause}] ${outcome.detail}` }),
      };
    }),
    'packages/stats/src',
  );
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
