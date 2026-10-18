/**
 * The item bank of the system validator (docs/validators.md section 12). An item is one capability of the
 * chain written as code: an id, a family, a tier from 1 (basic) to 5 (hardest), the level it belongs to,
 * the one component it points at, where it comes from (section 12.2), and a check that builds its input
 * from the seed and compares the chain's answer with an oracle known by construction.
 */

/** Where an item comes from, section 12.2. */
export type ItemSource =
  | 'parity'
  | 'research'
  | 'combination'
  | 'scale'
  | 'adversarial'
  | 'differential'
  | 'hostile'
  | 'contract';

import type { Tier } from '../../../ladder';

export type { Tier };

export type ItemContext = {
  seed: number;
  /** The repository root, for items that read files of the repository. */
  root: string;
  /** A folder of this run, removed at the end; items that need files write under it. */
  scratch: string;
};

/** What an item found: pass, or the reason it failed, with what was expected and what came back. */
export type ItemResult = { pass: true } | { pass: false; detail: string };

export type BankItem = {
  id: string;
  family: string;
  tier: Tier;
  /** The ladder level whose sub-bank holds the item, from 1. */
  level: number;
  /** The one component a failure points at. */
  component: string;
  source: ItemSource;
  /** What capability the item asks for, in one sentence. */
  title: string;
  /**
   * The one change that would make the item pass (docs/validators.md section 12.4), as a short sentence
   * naming the component and the behaviour. Items that one change would turn green share a cause, word for
   * word, and count once.
   */
  cause: string;
  check(ctx: ItemContext): Promise<ItemResult>;
};

export const PASS: ItemResult = { pass: true };

export function fail(detail: string): ItemResult {
  return { pass: false, detail };
}

/** Passes when every condition holds, else fails naming the first that does not. */
export function expectAll(conditions: ReadonlyArray<readonly [boolean, string]>): ItemResult {
  const first = conditions.find(([holds]) => !holds);
  return first ? fail(first[1]) : PASS;
}

/** The levels of the system bank, in order of the cost of diagnosis. */
export const BANK_LEVELS = [
  { level: 1, id: 'records', name: 'records stored, resumed and budgeted' },
  { level: 2, id: 'fault-reach', name: 'a planted fault reaches the right block and check' },
  { level: 3, id: 'precision', name: 'clean, hostile and failing agents read right' },
  { level: 4, id: 'drift-class', name: 'drift class of every failing block' },
  { level: 5, id: 'run-fields', name: 'every field of the run record' },
  { level: 6, id: 'recovery', name: 'recovery record of every perturbed run' },
  { level: 7, id: 'variance', name: 'variance and the parity verdict against their truth' },
  { level: 8, id: 'version-drift', name: 'drift between two versions at the right cell' },
  { level: 9, id: 'replay', name: 'replay equals live' },
  { level: 10, id: 'command-line', name: 'command-line exit codes and output fields' },
  { level: 11, id: 'scale', name: 'scale: the same answers at ten and a hundred times the size' },
  { level: 12, id: 'links', name: 'a planted fault reaches its prompt section through the block links' },
  { level: 13, id: 'not-run', name: 'blocks not run and blocked: records, outcomes and exit codes' },
] as const;

/** An item before its cause is set: a module states shared causes where one change fixes many items. */
export type Draft = Omit<BankItem, 'cause'> & { cause?: string };

/** The items with their causes: a stated cause, else the rule given, else the title (one item, one cause). */
export function withCauses(
  items: readonly Draft[],
  rule: (item: Draft) => string | undefined = () => undefined,
): BankItem[] {
  return items.map((item) => ({ ...item, cause: item.cause ?? rule(item) ?? item.title }));
}
