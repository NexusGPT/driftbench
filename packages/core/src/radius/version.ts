import type { TargetRef } from '../schema/common';

/**
 * The version of the agent a run measured, read from the target the run already records: the hash of the
 * registry prompt `campaign run --prompt` pinned, else the target's `variant` (`campaign run
 * --agent-version` writes it), else undefined. The target is part of the cell id and of the block cache
 * key, so two versions never share a cell or a cached block. A run with no version cannot be carried into
 * a later campaign: nothing says which agent produced it.
 */
export function agentVersionOf(run: { target: TargetRef }): string | undefined {
  return run.target.prompt?.hash ?? run.target.variant;
}

/**
 * The target with the agent version written as its `variant`. A target that already names a variant
 * keeps it: the label never overwrites what a spec or a `--target` pinned.
 */
export function withAgentVersion(target: TargetRef, version: string | undefined): TargetRef {
  if (version === undefined || target.variant !== undefined) return target;
  return { ...target, variant: version };
}
