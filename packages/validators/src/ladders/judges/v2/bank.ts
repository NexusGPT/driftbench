import * as judgesModule from '@agent-nexus/driftbench-judges';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { hash32 } from '../transforms';
import { SCREEN } from './causes';

/**
 * The item bank of the judge validator, ladder version 2 (docs/validators.md section 12).
 *
 * An item is one capability the judges package must have, written as code: an id, a family, a difficulty
 * tier from 1 to 5, a seeded generator that builds the input, an exact oracle that knows the answer by
 * construction, and the one component the item points at. A level is a sub-bank; it passes when every item
 * passes. Deterministic items use no model. Live items call real judge clients and run only in the billed
 * mode the owner approves.
 *
 * Items reach the package through its module namespace, read as a table of exports. A capability the package
 * lacks is a failing item that names the missing export: the bank is the roadmap.
 */

/** The judges package as items see it: its exports by name. Tests pass another table to plant a fault. */
export type JudgesApi = Readonly<Record<string, unknown>>;

export const realApi: JudgesApi = judgesModule as unknown as JudgesApi;

/** Thrown when the package lacks an export an item needs. */
export class MissingCapability extends Error {
  constructor(name: string, what: string) {
    super(`packages/judges exports no ${what} ${name}`);
    this.name = 'MissingCapability';
  }
}

/** A function export of the package, or a MissingCapability. */
export function fn<T>(api: JudgesApi, name: string): T {
  const value = api[name];
  if (typeof value !== 'function') throw new MissingCapability(name, 'function');
  return value as T;
}

/** A value export of the package, or a MissingCapability. */
export function value<T>(api: JudgesApi, name: string): T {
  if (!(name in api) || api[name] === undefined) throw new MissingCapability(name, 'value');
  return api[name] as T;
}

export type Tier = 1 | 2 | 3 | 4 | 5;

/** Where an item runs: the seed, the repository root, the package under test and the run mode. */
export type ItemContext = {
  seed: number;
  root: string;
  api: JudgesApi;
  /** A seeded generator for this item and seed. */
  random: () => number;
};

/** The verdict of one item on one seed: pass, and what was expected and observed when it failed. */
export type ItemResult = { pass: boolean; detail: string };

export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  /** The level the item belongs to. */
  level: string;
  /** The one component a failure points at. */
  component: string;
  /** Live items call real judge clients: billed, and only in the billed mode. */
  live?: boolean;
  /** The one change in packages/judges that makes the item pass (section 12.4); set by the bank from causes.ts. */
  cause?: string;
  /** Runs the generator, the package and the oracle on one seed. */
  run(ctx: ItemContext): Promise<ItemResult> | ItemResult;
};

/**
 * Builds an item from its three parts. `generate` makes the input from the seeded generator, `oracle` knows
 * the answer from the input alone, `observe` asks the package. `same` compares; by default the canonical
 * JSON of both must be equal.
 */
export function item<I, O>(def: {
  id: string;
  family: string;
  tier: Tier;
  level: string;
  component: string;
  live?: boolean;
  generate(random: () => number, ctx: ItemContext): I | Promise<I>;
  oracle(input: I, ctx: ItemContext): O | Promise<O>;
  observe(api: JudgesApi, input: I, ctx: ItemContext): O | Promise<O>;
  same?: (expected: O, observed: O) => boolean;
  show?: (value: O) => string;
}): BankItem {
  const show = def.show ?? ((v: O) => clip(stable(v), 220));
  const same = def.same ?? ((a: O, b: O) => stable(a) === stable(b));
  return {
    id: def.id,
    family: def.family,
    tier: def.tier,
    level: def.level,
    component: def.component,
    ...(def.live ? { live: true } : {}),
    async run(ctx) {
      const input = await def.generate(ctx.random, ctx);
      const expected = await def.oracle(input, ctx);
      let observed: O;
      try {
        observed = await def.observe(ctx.api, input, ctx);
      } catch (cause) {
        return { pass: false, detail: `expected ${show(expected)}; the package threw: ${message(cause)}` };
      }
      return same(expected, observed)
        ? { pass: true, detail: '' }
        : { pass: false, detail: `expected ${show(expected)}, observed ${show(observed)}` };
    },
  };
}

/** Runs one item on one seed. A throw anywhere is a failure that names it. */
export async function runItem(
  entry: BankItem,
  seed: number,
  root: string,
  api: JudgesApi,
): Promise<ItemResult> {
  const random = mulberry32(hash32(`${seed}:${entry.id}`));
  let result: ItemResult;
  try {
    result = await entry.run({ seed, root, api, random });
  } catch (cause) {
    result = { pass: false, detail: `the item threw: ${message(cause)}` };
  }
  if (result.pass || !entry.cause) return result;
  // A screen behaviour needs the base screen first: say so while screenData does not exist yet.
  const fix =
    entry.cause.startsWith('In screenData:') && result.detail.includes('exports no function screenData')
      ? `first ${SCREEN.replace(/^Add/, 'add')}. Then: ${entry.cause}`
      : entry.cause;
  return { ...result, detail: `${result.detail}. Fix: ${fix}` };
}

export function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function clip(text: string, length = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 3)}...` : flat;
}

/** JSON with sorted keys, undefined dropped, NaN and infinities kept readable. */
export function stable(value: unknown): string {
  const seen = (v: unknown): unknown => {
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (Array.isArray(v)) return v.map(seen);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        const child = (v as Record<string, unknown>)[key];
        if (child !== undefined) out[key] = seen(child);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(seen(value)) ?? 'undefined';
}

/** A seeded pick from a list. */
export function pick<T>(random: () => number, list: readonly T[]): T {
  if (list.length === 0) throw new RangeError('pick from an empty list');
  return list[Math.floor(random() * list.length)] as T;
}

/** A seeded whole number in [low, high]. */
export function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/** A seeded shuffle, returning a new list. */
export function shuffled<T>(random: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Plain words for seeded filler text, with no number, no question mark and no word a criterion reads. */
export const FILLER_WORDS = [
  'plan',
  'line',
  'signal',
  'town',
  'street',
  'home',
  'phone',
  'week',
  'month',
  'speed',
  'data',
  'team',
  'store',
  'note',
  'detail',
  'option',
  'choice',
  'summary',
  'reply',
  'thanks',
] as const;

export function filler(random: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) out.push(pick(random, FILLER_WORDS));
  return `${out.join(' ')}.`;
}
