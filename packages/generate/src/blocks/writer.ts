import type { BlockLink } from '@agent-nexus/driftbench-core';

/**
 * The block writer of both generators: `driftbench generate` (the prompt map) and `driftbench estate
 * generate` (the estate map) write every block of a spec through it. A generator decides what a block says
 * (its ask, its Given and its Then); the writer writes the block and the links that say where it comes from,
 * in `metadata.links`, one entry per target:
 *
 * - `rule`: each rule the block tests, by its readable id (an atom id, or dimension=value of a prompt map)
 *   and by the ledger id of the unit it was read from when its reader gave one;
 * - `plan_row`: the row the block was written for, with the values of its cell;
 * - `source_turn`: the recorded turn the ask comes from, when it comes from one.
 *
 * Every link is `declared` by the `generator`, at the version of the map. A mutant of the rule decides later
 * whether it is `verified` or `refuted`. Links stay out of the spec hash, so they never move a run id.
 */

/** A rule a block tests: its readable id and, when its reader gave one, the ledger id of its unit. */
export type RuleRef = { rule: string; ledger?: string };

/** The recorded turn an ask comes from. */
export type SourceTurn = { conversation: string; turn: number };

/** Where a block comes from: the rules it tests, the row it was written for, the turn its ask was recorded at. */
export type BlockOrigin = {
  rules: readonly RuleRef[];
  row: { id: string; values: Readonly<Record<string, string>> };
  turn?: SourceTurn;
};

/** A block of a spec: its id and what the generator decided it says (its ask, its Given, its Then). */
export type SpecBlock = { id: string } & Record<string, unknown>;

/** A block as a generator decided it, with its origin. */
export type BlockInput<B extends SpecBlock = SpecBlock> = { block: B; origin: BlockOrigin };

export type WrittenBlocks<B extends SpecBlock = SpecBlock> = { blocks: B[]; links: BlockLink[] };

/**
 * Writes the blocks of one spec and their links. `version` is the version of the map the rules are read from
 * (the spec's own `version`). Each block is written as the generator gave it, keys in their order; the links
 * follow the blocks, and for each block its rules in the order given (each once), its row, then its turn.
 */
export function writeBlocks<B extends SpecBlock>(
  inputs: readonly BlockInput<B>[],
  version: string,
): WrittenBlocks<B> {
  const blocks: B[] = [];
  const links: BlockLink[] = [];
  for (const { block, origin } of inputs) {
    blocks.push(block);
    links.push(...linksOf(block.id, origin, version));
  }
  return { blocks, links };
}

/** The links of one block, in the writer's order. */
export function linksOf(block: string, origin: BlockOrigin, version: string): BlockLink[] {
  const links: BlockLink[] = [];
  const seen = new Set<string>();
  for (const { rule, ledger } of origin.rules) {
    if (seen.has(rule)) continue;
    seen.add(rule);
    links.push({
      block,
      to: { kind: 'rule', rule, ...(ledger !== undefined ? { ledger } : {}) },
      relation: 'verifies',
      status: 'declared',
      created_by: 'generator',
      at_version: version,
    });
  }
  links.push({
    block,
    to: { kind: 'plan_row', row: origin.row.id, values: { ...origin.row.values } },
    relation: 'derived_from',
    status: 'declared',
    created_by: 'generator',
    at_version: version,
  });
  if (origin.turn) {
    links.push({
      block,
      to: { kind: 'source_turn', conversation: origin.turn.conversation, turn: origin.turn.turn },
      relation: 'derived_from',
      status: 'declared',
      created_by: 'generator',
    });
  }
  return links;
}

/**
 * The recorded turn a source path names: `<conversation>#<turn>`, the id `driftbench intake logs` gives each
 * user turn it keeps. Anything else names no turn.
 */
export function turnOfSource(source: string | undefined): SourceTurn | undefined {
  const match = source === undefined ? null : /^([^#\s]+)#(\d+)$/.exec(source);
  if (!match?.[1] || match[2] === undefined) return undefined;
  return { conversation: match[1], turn: Number(match[2]) };
}
