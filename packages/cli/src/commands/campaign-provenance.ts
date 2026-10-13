import {
  type AgentAdapter,
  agentVersionOf,
  type Campaign,
  contentHash,
  type TargetRef,
} from '@agent-nexus/driftbench-core';

/** Runtime adapter versions and declared agent versions, without copying target configuration into the stamp. */
export function campaignProvenance(
  targets: readonly TargetRef[],
  adapterFor: (target: TargetRef) => AgentAdapter,
): NonNullable<Campaign['provenance']> {
  return {
    version: 1,
    adapters: [...new Map(targets.map((target) => [contentHash(target), target])).values()].map((target) => {
      const adapter = adapterFor(target);
      return {
        target: contentHash(target),
        id: adapter.id,
        version: adapter.version,
        agentVersion: agentVersionOf({ target }) ?? null,
      };
    }),
  };
}
