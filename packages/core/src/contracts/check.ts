import type { BlockResult, Observed, ResolvedGiven, RunMode, Verdict } from '../schema/run';
import type { BlockSpec, Expect, Spec } from '../schema/spec';
import type { ArtifactReaderRegistry } from './artifacts';

/**
 * The machine check contract. A check reads what a block expected and what was observed and
 * returns verdicts with evidence. A machine fail is final: no judge overturns it.
 *
 * Checks never call a model and never touch the network. Every check ships with a mutation test:
 * break the target case, see the check go red, restore it.
 */

export type CheckContext = {
  readonly spec: Spec;
  readonly mode: RunMode;
  readonly blockIndex: number;
  readonly block: BlockSpec;
  /** The block's expectations, or the perturbation's when the block was injected. */
  readonly expect: Expect;
  readonly given: ResolvedGiven;
  readonly observed: Observed;
  /** Results of the blocks before this one in the same run. */
  readonly history: readonly BlockResult[];
  /** The ledger after this block: the seed, every earlier ledger_add, and this block's. */
  readonly ledger: Readonly<Record<string, unknown>>;
  /** The end state the adapter read, when the spec names a source and the block is the last one. */
  readonly endState?: unknown;
  /** Readers for the artifact checks. Absent when no reader package is loaded. */
  readonly artifacts?: ArtifactReaderRegistry;
  /** Reads a produced file from the workspace, when the adapter owns one. */
  readonly readArtifact?: (path: string) => Promise<Uint8Array>;
};

export interface Check {
  /** The check name, which prefixes its verdict ids: tools, must, lang, end_state, workspace. */
  readonly name: string;
  /** True when this context carries something the check can judge; false yields no verdict. */
  applies(ctx: CheckContext): boolean;
  /** One verdict per fact checked. Evidence names the matched or missing thing, never only "fail". */
  evaluate(ctx: CheckContext): Promise<Verdict[]> | Verdict[];
}

/** Builds a machine verdict. Machine verdicts are gating by default. */
export function machineVerdict(
  check: string,
  id: string,
  outcome: Verdict['outcome'],
  evidence: string,
  options: { gating?: boolean; score?: number; name?: string } = {},
): Verdict {
  return {
    id: `${check}.${id}`,
    kind: 'machine',
    name: options.name ?? check,
    gating: options.gating ?? true,
    outcome,
    evidence,
    ...(options.score === undefined ? {} : { score: options.score }),
  };
}

/** A named set of checks the runner applies to every block. Order is the order of evaluation. */
export type CheckSet = readonly Check[];
