import {
  type AgentAdapter,
  adapterProvenance,
  agentVersionOf,
  type Campaign,
  provenanceHash,
  type TargetRef,
} from '@agent-nexus/driftbench-core';

/** Runtime adapter versions and declared agent versions, without copying target configuration into the stamp. */
export function campaignProvenance(
  targets: readonly TargetRef[],
  adapterFor: (target: TargetRef) => AgentAdapter,
  endStateSnapshots = false,
  realizedText = false,
): NonNullable<Campaign['provenance']> {
  return {
    version: 2,
    ...(endStateSnapshots ? { endStateSnapshots: true as const } : {}),
    ...(realizedText ? { realizedText: true as const } : {}),
    adapters: [...new Map(targets.map((target) => [provenanceHash(target), target])).values()].map(
      (target) => {
        const adapter = adapterFor(target);
        return {
          targetHash: provenanceHash(target),
          ...adapterProvenance(adapter, target.adapter),
          agentVersionHash:
            agentVersionOf({ target }) === undefined ? null : provenanceHash(agentVersionOf({ target })),
        };
      },
    ),
  };
}
