import type { ExtractResult, SourceText } from '@agent-nexus/driftbench-generate';
import type { Extract } from '../run';
import type { CodeEntry } from './facts';
import type { Planted } from './perfect';

/**
 * The bank of the map validator (docs/validators.md section 12). An item is one capability the extraction
 * pipeline must have, written as code: an id, a family, a difficulty tier, a seeded generator that builds the
 * input and the perfect model's knowledge of it, an exact oracle that knows the answer by construction, and
 * the one component it points at. Levels group items by the cost of diagnosing them; a level passes when
 * every one of its items passes.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;

/** One extraction an item asks for: the files, what the perfect model knows, and the budget in milliseconds. */
export type Case = {
  /** A label for the item detail, such as `base` or `half-a`. */
  label: string;
  sources: SourceText[];
  /** Every entry a perfect model can report, each with the text that must be visible to report it. */
  planted: Planted[];
  /** The longest the extraction may take; absent: no budget. */
  budgetMs?: number;
};

/** What a case gave: the extractor's result and the time it took. */
export type CaseRun = { case: Case; result: ExtractResult; ms: number; error?: string };

export type Outcome = { pass: boolean; detail: string };

export type BankItem = {
  /** `<family>.<slug>`, unique in the bank. */
  id: string;
  family: string;
  tier: Tier;
  /** The ladder level the item belongs to, 1 to LEVELS.length. */
  level: number;
  /** The one component a failure points at. */
  component: string;
  /** The capability, in one line. */
  title: string;
  /**
   * The one change that would make the item pass (docs/validators.md section 12.4, distinct causes), as
   * `<component>:<change>`, such as `tools:multipleOf`. Items that share a cause count once.
   */
  cause: string;
  /** The seeded generator: the cases to extract on this seed. */
  generate(seed: number): Case[];
  /** The exact oracle: whether the runs hold what the generator planted. */
  check(runs: CaseRun[], seed: number): Outcome;
  /** An item that drives its own runs (the first-version levels) replaces generate and check with this. */
  run?: (seed: number, deps: BankDeps) => Promise<Outcome>;
  /** The code truth of a single-case item on a seed, for tests of the items themselves. */
  code?: (seed: number) => CodeEntry[];
};

/** What the bank runs with. Tests plant a faulty extractor here. */
export type BankDeps = { extract?: Extract };

/** The ladder levels of the bank, in the order of the cost of diagnosing a failure. */
export const LEVELS = [
  {
    id: 'structured',
    name: 'structured files',
    what: 'the code pre-pass reads inventories and tool schemas',
  },
  { id: 'containers', name: 'prompt containers', what: 'prompts inside JSON, YAML, code and markup files' },
  {
    id: 'prose',
    name: 'prose across styles',
    what: 'rules, stages and personas in every prompt style and pair',
  },
  {
    id: 'relations',
    name: 'relations and constraints',
    what: 'tool calls, paths, recoveries, impossible cells',
  },
  {
    id: 'metamorphic',
    name: 'metamorphic invariance',
    what: 'the map does not change when only wording does',
  },
  { id: 'composition', name: 'additivity and unit response', what: 'halves add up, one more gives one more' },
  {
    id: 'semantics',
    name: 'semantics and roles',
    what: 'polarity, conditions, priors, roles the prompt states',
  },
  { id: 'scale', name: 'scale', what: 'prompts of 100k characters and more, inside a time budget' },
  {
    id: 'cutter',
    name: 'the pointer reader cuts the prompts',
    what: 'exact slices, no sentence split, containers, fingerprints and ledger ids of every planted entry',
  },
] as const;

export function levelOf(id: (typeof LEVELS)[number]['id']): number {
  return LEVELS.findIndex((level) => level.id === id) + 1;
}
