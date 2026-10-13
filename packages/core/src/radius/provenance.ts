import { provenanceHash } from '../runner/provenance';
import { BlockProvenance, CampaignProvenance, RunProvenance } from '../schema/provenance';
import type { Campaign, RunResult } from '../schema/run';
import { agentVersionOf } from './version';

/** A partial stamp is legacy, including missing target coverage and unknown random seeds. */
export function completeBaselineProvenance(baseline: {
  provenance?: Campaign['provenance'];
  runs: readonly RunResult[];
}): boolean {
  const campaign = CampaignProvenance.safeParse(baseline.provenance);
  if (!campaign.success || campaign.data.adapters.length === 0) return false;
  return baseline.runs.every((run) => {
    const parsed = RunProvenance.safeParse(run.provenance);
    if (!parsed.success || parsed.data.driver.seedsHash === null) return false;
    const stamp = parsed.data;
    const version = run.carried?.agentVersion ?? agentVersionOf(run);
    if (version === undefined || stamp.agentVersionHash !== provenanceHash(version)) return false;
    if (
      (run.target.adapter === 'process' || stamp.adapter.requiresCacheIdentity) &&
      stamp.adapter.cacheIdentityHash === null
    )
      return false;
    const matches = campaign.data.adapters.filter((entry) => entry.targetHash === provenanceHash(run.target));
    if (matches.length !== 1) return false;
    const adapter = matches[0];
    if (
      !adapter ||
      adapter.agentVersionHash !== provenanceHash(agentVersionOf(run)) ||
      adapter.idHash !== stamp.adapter.idHash ||
      adapter.versionHash !== stamp.adapter.versionHash ||
      adapter.cacheIdentityHash !== stamp.adapter.cacheIdentityHash ||
      adapter.requiresCacheIdentity !== stamp.adapter.requiresCacheIdentity
    )
      return false;
    return (
      run.blocks.length > 0 &&
      run.blocks.every(
        (block) =>
          /^[0-9a-f]{12}$/.test(block.givenHash) && BlockProvenance.safeParse(block.provenance).success,
      )
    );
  });
}
