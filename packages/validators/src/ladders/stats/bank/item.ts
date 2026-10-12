import { generator } from '../draw';
import type { StatsImpl } from '../reference';

/**
 * One item of the statistics bank (docs/validators.md section 12.1): one capability the statistics package must
 * have, as code. The item builds its input from a seeded generator, knows the answer by construction (the
 * oracle) and names the one source file it points at. `check` returns pass or fail with a message an executor
 * can act on without reading the validator: what was called, what came back, what was expected, what to do.
 */
export type Tier = 1 | 2 | 3 | 4 | 5;

/** The sub-banks, in the order the ladder runs them (cheapest diagnosis first). */
export const BANK_LEVELS = [
  'reference',
  'degenerate',
  'reproducibility',
  'analytic',
  'simulation',
  'scale',
  'roadmap',
] as const;
export type BankLevel = (typeof BANK_LEVELS)[number];

export type ItemContext = {
  seed: number;
  /** The statistics functions under test; tests replace one to plant a fault. */
  s: StatsImpl;
  /** The repository root, where fixtures live. */
  root: string;
  /** A generator seeded by the seed and the item id: the item's own stream. */
  rng: () => number;
};

export type ItemOutcome = { pass: boolean; detail: string };

export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  level: BankLevel;
  component: string;
  /**
   * The one change that would make the item pass (docs/validators.md section 12.4: items sharing a cause count
   * once). Filled by `causeOf` in bank/index.ts when the item does not name it.
   */
  cause?: string;
  /** How long the item may run before the validator stops it; DEFAULT_ITEM_BUDGET_MS when absent. */
  budgetMs?: number;
  check(ctx: ItemContext): ItemOutcome | Promise<ItemOutcome>;
};

/** A stable 32-bit hash of an item id, so each item draws its own stream on each seed. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The item's generator on a seed. */
export function itemRng(seed: number, id: string): () => number {
  return generator(seed, idHash(id));
}

export const ok = (detail = 'ok'): ItemOutcome => ({ pass: true, detail });
export const fail = (detail: string): ItemOutcome => ({ pass: false, detail });

/** A number as items print it. */
export function show(value: unknown): string {
  if (typeof value === 'number') return String(value);
  try {
    const text = JSON.stringify(value, (_k, v) =>
      typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    );
    return text === undefined ? String(value) : text.length > 160 ? `${text.slice(0, 157)}...` : text;
  } catch {
    return String(value);
  }
}

/** Calls f and describes what happened: a value, or the error's class and message. */
export function attempt<T>(f: () => T): { value?: T; error?: Error } {
  try {
    return { value: f() };
  } catch (cause) {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }
}

/** Whether |got - want| <= tol, with NaN never near. */
export function near(got: number, want: number, tol: number): boolean {
  return Math.abs(got - want) <= tol;
}

/** The function `name` of the statistics package, or undefined when it does not export one. */
export function exported(s: StatsImpl, name: string): ((...args: never[]) => unknown) | undefined {
  const value = (s as unknown as Record<string, unknown>)[name];
  return typeof value === 'function' ? (value as (...args: never[]) => unknown) : undefined;
}
