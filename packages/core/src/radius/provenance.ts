import { provenanceDigest, provenanceHash } from '../runner/provenance';
import type { TargetRef } from '../schema/common';
import { BlockProvenance, CampaignProvenance, RunProvenance } from '../schema/provenance';
import type { Campaign, RunResult } from '../schema/run';
import { canonicalJson } from '../spec/hash';
import type { ChangeManifest } from './change';
import { agentVersionOf } from './version';

/** A partial stamp is legacy, including missing target coverage and unknown random seeds. */
export function completeBaselineProvenance(baseline: {
  provenance?: Campaign['provenance'];
  runs: readonly RunResult[];
}): boolean {
  const campaign = CampaignProvenance.safeParse(baseline.provenance);
  if (!campaign.success || campaign.data.adapters.length === 0) return false;
  return baseline.runs.every((run) => {
    if (!run.provenanceDigest || run.provenanceDigest !== provenanceDigest(run)) return false;
    const parsed = RunProvenance.safeParse(run.provenance);
    if (!parsed.success || parsed.data.driver.seedsHash === null || !completeRunStamp(run.provenance))
      return false;
    const stamp = parsed.data;
    const version = agentVersionOf(run);
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

/**
 * The radius reasons about precisely this declared agent transition. These are the ONLY allowed
 * differences; all other fields (including future stamp fields) are compared by default.
 */
export const ALLOWED_VERSION_TRANSITION_FIELDS = [
  'agentVersionHash',
  'targetVersionHash',
  'agentVersionLabelHash',
] as const;

function completeRunStamp(stamp: RunResult['provenance']): boolean {
  return (
    stamp !== undefined &&
    Object.keys(RunProvenance.shape).every(
      (key) => Object.hasOwn(stamp, key) && (stamp as Record<string, unknown>)[key] !== undefined,
    )
  );
}
const targetVersion = ({ variant, prompt }: TargetRef) => provenanceHash({ variant, prompt });

/** Compare the actual candidate context, never a baseline-derived substitute for it. */
export function sameCarryContext(
  before: RunResult['provenance'],
  after: RunResult['provenance'],
  oldTarget: TargetRef,
  newTarget: TargetRef,
  manifest: ChangeManifest,
): boolean {
  if (
    !before ||
    !after ||
    !completeRunStamp(before) ||
    !completeRunStamp(after) ||
    !RunProvenance.safeParse(after).success ||
    after.driver.seedsHash === null
  )
    return false;
  if (
    agentVersionOf({ target: oldTarget }) !== manifest.from ||
    agentVersionOf({ target: newTarget }) !== manifest.to ||
    before.agentVersionHash !== provenanceHash(manifest.from) ||
    after.agentVersionHash !== provenanceHash(manifest.to) ||
    before.targetVersionHash !== targetVersion(oldTarget) ||
    after.targetVersionHash !== targetVersion(newTarget)
  )
    return false;
  if (
    before.agentVersionLabelHash !== after.agentVersionLabelHash &&
    (before.agentVersionLabelHash !== provenanceHash(manifest.from) ||
      after.agentVersionLabelHash !== provenanceHash(manifest.to))
  )
    return false;
  const allowed = new Set<string>(ALLOWED_VERSION_TRANSITION_FIELDS);
  // Union rather than one side's keys: omitted or newly introduced dimensions never disappear.
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].every(
    (key) =>
      allowed.has(key) ||
      (Object.hasOwn(before, key) &&
        Object.hasOwn(after, key) &&
        canonicalJson((before as Record<string, unknown>)[key]) ===
          canonicalJson((after as Record<string, unknown>)[key])),
  );
}
