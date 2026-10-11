import { execFileSync } from 'node:child_process';
import type { SeedSpec } from './ladder';

/** The most seeds one run takes. */
export const MAX_SEEDS = 1000;

/** The hidden seed outside a git repository: fixed, and the run says so. */
export const FALLBACK_HIDDEN_SEED = 7_777_777;

/** Hidden seeds start here, so they never collide with the visible seeds a builder uses. */
const HIDDEN_BASE = 1_000_000;

export type HiddenSeed = {
  seed: number;
  /** `head`: derived from the commit; `fallback`: no commit could be read. */
  source: 'head' | 'fallback';
  head?: string;
  note?: string;
};

/** Reads the commit a folder is at. Throws when the folder is not in a git repository. */
export type HeadReader = (root: string) => string;

export const gitHead: HeadReader = (root) =>
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/**
 * The hidden seed: 1000000 plus the first 32 bits of `git rev-parse HEAD` modulo 1000000000. Every commit
 * gets its own seed, so a fix tuned to the visible seeds meets a seed it was not built against. Outside a
 * repository the seed is the fixed 7777777 and the result carries a note.
 */
export function hiddenSeed(root: string, readHead: HeadReader = gitHead): HiddenSeed {
  let head: string;
  try {
    head = readHead(root);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
    return {
      seed: FALLBACK_HIDDEN_SEED,
      source: 'fallback',
      note: `git rev-parse HEAD failed (${reason}); the hidden seed falls back to ${FALLBACK_HIDDEN_SEED}.`,
    };
  }
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) {
    return {
      seed: FALLBACK_HIDDEN_SEED,
      source: 'fallback',
      note: `git rev-parse HEAD gave "${head}", not a commit id; the hidden seed falls back to ${FALLBACK_HIDDEN_SEED}.`,
    };
  }
  return {
    seed: HIDDEN_BASE + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000),
    source: 'head',
    head,
  };
}

export type SeedOptions = {
  seed?: string;
  seeds?: string;
};

/**
 * The visible seeds of a run: `--seed n` and `--seeds a..b` together, in order, without repeats; seed 1 when
 * neither is given. Returns a message naming the problem for bad input.
 */
export function parseSeeds(options: SeedOptions): number[] | string {
  const values: number[] = [];
  if (options.seed !== undefined) {
    const seed = whole(options.seed);
    if (seed === undefined) return `--seed takes a whole number, not "${options.seed}".`;
    values.push(seed);
  }
  if (options.seeds !== undefined) {
    const match = /^\s*(\d+)\s*\.\.\s*(\d+)\s*$/.exec(options.seeds);
    const from = match ? whole(match[1] as string) : undefined;
    const to = match ? whole(match[2] as string) : undefined;
    if (from === undefined || to === undefined || from > to) {
      return `--seeds takes a..b with whole numbers a <= b, such as 1..20, not "${options.seeds}".`;
    }
    if (to - from + 1 > MAX_SEEDS) return `--seeds covers at most ${MAX_SEEDS} seeds.`;
    for (let seed = from; seed <= to; seed += 1) values.push(seed);
  }
  if (values.length === 0) values.push(1);
  return [...new Set(values)];
}

/** The seed list of a run: the visible seeds, then the hidden seed when asked. */
export function seedSpecs(visible: readonly number[], hidden?: HiddenSeed): SeedSpec[] {
  const specs: SeedSpec[] = visible.map((seed) => ({ seed, hidden: false }));
  if (hidden) specs.push({ seed: hidden.seed, hidden: true });
  return specs;
}

function whole(text: string): number | undefined {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && Number.isSafeInteger(value) ? value : undefined;
}
