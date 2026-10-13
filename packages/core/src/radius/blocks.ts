import type { AgentAdapter } from '../contracts/adapter';
import type { UserDriver } from '../contracts/driver';
import { canonicalGiven, resolveGiven } from '../runner/given';
import type { BlockResult, RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { canonicalJson, contentHash } from '../spec/hash';
import { type CarryLimits, planRadiusCampaign } from './carry';
import type { ChangeManifest } from './change';
import { radiusOf } from './radius';

export type BlockReuse = {
  source: RunResult;
  fromCampaign: string;
  manifest: ChangeManifest;
  maxCarry?: number;
  maxAgeDays?: number;
};
export const END_STATE_FULL_RERUN = 'end state cannot be recomposed: full cell rerun';

/** A refusal is a full cell rerun, never a guessed carried block. */
export function planBlockRerun(
  spec: Spec,
  target: RunResult['target'],
  adapter: AgentAdapter,
  driver: UserDriver,
  reuse: BlockReuse,
  now: Date,
): { indices: Set<number>; carried: Map<number, BlockResult> } | { reason: string } {
  const { source, manifest } = reuse;
  const fail = (reason: string) => ({ reason });
  if (source.mode !== 'T' || adapter.capabilities().sandbox)
    return fail('only independent mode T cells support block reruns');
  if (
    source.endState?.match === false ||
    source.status !== 'completed' ||
    source.blocks.length !== spec.blocks.length ||
    source.blocks.some((b) => !b.pass || !b.provenance)
  )
    return fail('the baseline is incomplete, failing or lacks block provenance');
  if (source.rejudged) return fail('a re-judged baseline requires a full agent measurement');
  if (
    driver.id !== 'scripted' ||
    canonicalJson(driver.seeds) !== '{}' ||
    source.provenance?.driver.id !== driver.id ||
    canonicalJson(source.provenance.driver.seeds) !== '{}'
  )
    return fail('the driver inputs are uncertain');
  if (source.provenance.adapter.id !== adapter.id || source.provenance.adapter.version !== adapter.version)
    return fail('the adapter identity changed');
  if (source.specHash !== contentHash(spec)) return fail('the full spec hash changed');
  const radius = radiusOf([{ spec, hash: source.specHash }], manifest, { modes: ['T'] });
  if (radius.whole) return fail(radius.whole.reason);
  const indices = new Set(radius.specs[0]?.blocks.filter((b) => b.state.T !== 'out').map((b) => b.index));
  if (!indices.size || indices.size === spec.blocks.length) return fail('the radius needs no partial cell');
  // Prove carry validity with the existing version/spec/age/count rules after the dependency proof.
  const eligibility = structuredClone(radius);
  for (const entry of eligibility.specs) for (const cell of entry.cells) cell.in = false;
  const cell = { ...source, target, cellId: source.runId, blocks: source.blocks.length };
  const limits: CarryLimits = { now, maxCarry: reuse.maxCarry, maxAgeDays: reuse.maxAgeDays };
  const plan = planRadiusCampaign(
    [cell],
    eligibility,
    manifest,
    { campaignId: reuse.fromCampaign, runs: [source] },
    limits,
  );
  const eligible = plan.carried[0];
  if (!eligible) return fail(plan.nothing ?? plan.refused[0]?.reason ?? 'carry validity is unknown');
  if (spec.end_state !== undefined && source.blocks.some((b) => !b.provenance?.endState))
    return fail(END_STATE_FULL_RERUN);
  const carried = new Map<number, BlockResult>();
  for (let index = 0; index < source.blocks.length; index++) {
    if (indices.has(index)) continue;
    const block = source.blocks[index];
    if (!block || block.index !== index || block.provenance?.specIndex !== index)
      return fail('the baseline block order is uncertain');
    // A carried target version differs; its Given must match the spec resolved under the source target.
    const canonical = canonicalGiven(spec, index);
    if (
      !block.carried &&
      resolveGiven(canonical.state, canonical.prefix, source.target).hash !== block.givenHash
    )
      return fail('the baseline Given differs');
    if (canonicalJson(block.provenance.stimulus) !== canonicalJson(spec.blocks[index]?.when))
      return fail('the baseline stimulus differs');
    const measuredAt = block.carried?.measuredAt ?? (block.carried ? undefined : source.finishedAt);
    if (!measuredAt || !Number.isFinite(Date.parse(measuredAt)) || Date.parse(measuredAt) > now.getTime())
      return fail('the carried block age is unknown');
    const campaigns = (block.carried?.age.campaigns ?? source.carried?.age.campaigns ?? 0) + 1;
    const days = (now.getTime() - Date.parse(measuredAt)) / 86400000;
    if (campaigns > (reuse.maxCarry ?? 5) || days > (reuse.maxAgeDays ?? 7))
      return fail('the carried block exceeds an age or count limit');
    carried.set(index, {
      ...block,
      carried: {
        ...eligible.carried,
        ...(block.carried ?? {}),
        measuredAt,
        age: { campaigns, days: Math.round(days * 100) / 100 },
      },
    });
  }
  return { indices, carried };
}
