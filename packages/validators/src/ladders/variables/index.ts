import { defineLadder, type Ladder } from '../../ladder';
import {
  type BankItem,
  type BankRun,
  LEVELS,
  type Level,
  levelMeasure,
  runInProcess,
  variablesBank,
} from './bank/index';
import { CAN_ISOLATE, runIsolated } from './bank/isolate';
import { loadImpl } from './impl';
import type { VariablesImpl } from './interface';

export { type BankItem, LEVELS, type Level, variablesBank } from './bank/index';
export type { VariablesImpl } from './interface';

/** The ladder version this bank is (docs/validators.md section 12.5: floors are per ladder version). */
export const VARIABLES_LADDER_VERSION = 2;

const LEVEL_TEXT: Record<Level, { name: string; metric: string }> = {
  'store-core': {
    name: 'the store file: loader, ids and boundaries',
    metric: 'store-core items (file loader, ids, boundaries) passing / items',
  },
  'store-readers': {
    name: 'the readers of the three sources',
    metric: 'reader items (estate spans, quotes, owner words, conversations, merging) passing / items',
  },
  constraints: {
    name: 'impossible pairs and weights',
    metric: 'impossible-pair and weight items passing / items',
  },
  counter: {
    name: 'the tuple counter against exhaustive enumeration',
    metric: 'counter items matching enumeration, closed forms and big integers / items',
  },
  strength: {
    name: 'variable-strength coverage against a brute-force counter',
    metric: 'strength items covering every allowed tuple within the row bound / items',
  },
  'plan-order': {
    name: 'seed rows and budget order',
    metric: 'seed-row and budget-order items passing / items',
  },
  determinism: {
    name: 'same seed, same plan, byte for byte',
    metric: 'determinism items passing / items',
  },
  scale: {
    name: 'bounded rows and time at hundreds of variables',
    metric: 'scale items within their row and processor-time bounds / items',
  },
};

export type VariablesLadderOptions = {
  /** An implementation to score instead of the adapter (tests); the bank then runs in this process. */
  impl?: Partial<VariablesImpl>;
  /** The module the injected implementation stands for, for the items that start a second process. */
  implModule?: string;
  /** Only the items this keeps (tests); every item by default. */
  filter?: (item: BankItem) => boolean;
  /** Run the bank in this process instead of child processes (no protection against an endless loop). */
  inProcess?: boolean;
};

/**
 * A level opens only when every level before it has no failing item. An item of a level that is still locked counts
 * as failing, whatever it returned, and says which level locks it, so the score never rises because items are hidden
 * and a product cannot collect later levels before it has earlier ones.
 */
export function lockedRun(items: readonly BankItem[], run: BankRun, level: Level): BankRun {
  const at = LEVELS.indexOf(level);
  for (const earlier of LEVELS.slice(0, at)) {
    const failing = items.filter(
      (item) => item.level === earlier && !(run.get(item.id)?.pass ?? false),
    ).length;
    if (failing === 0) continue;
    const locked: BankRun = new Map();
    for (const item of items) {
      if (item.level !== level) continue;
      locked.set(item.id, {
        pass: false,
        detail: `locked: level ${earlier} still has ${failing} failing item${failing === 1 ? '' : 's'}; it opens when none fails`,
      });
    }
    return locked;
  }
  return run;
}

/**
 * The variables validator (docs/validators.md sections 1 and 12): a bank of items in seven sub-banks, each a
 * level with threshold 1. A seed's whole bank runs once, in child processes that stop an item past its budget,
 * and each level reads its items from that run. The interface the bank defines is in interface.ts.
 */
export function variablesLadder(options: VariablesLadderOptions = {}): Ladder {
  const inProcess = options.inProcess === true || options.impl !== undefined || !CAN_ISOLATE;
  const runs = new Map<string, Promise<{ items: BankItem[]; run: BankRun }>>();
  const seedRun = (seed: number, root: string) => {
    const key = `${seed}:${root}`;
    let pending = runs.get(key);
    if (!pending) {
      pending = (async () => {
        const items = variablesBank().filter(options.filter ?? (() => true));
        let run: BankRun;
        if (inProcess) {
          const loaded = options.impl ? { impl: options.impl, module: options.implModule } : await loadImpl();
          run = await runInProcess(items, seed, root, loaded.impl, loaded.module);
        } else {
          run = await runIsolated(items, seed, root);
        }
        return { items, run };
      })();
      runs.set(key, pending);
    }
    return pending;
  };
  return defineLadder({
    component: 'variables',
    version: VARIABLES_LADDER_VERSION,
    levels: LEVELS.map((level) => ({
      id: level,
      name: LEVEL_TEXT[level].name,
      metric: LEVEL_TEXT[level].metric,
      threshold: 1,
      compute: async ({ seed, root }) => {
        const { items, run } = await seedRun(seed, root);
        return levelMeasure(
          items.filter((item) => item.level === level),
          lockedRun(items, run, level),
        );
      },
    })),
  });
}
