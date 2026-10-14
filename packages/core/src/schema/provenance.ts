import { z } from 'zod';

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const AdapterIdentity = z.strictObject({
  idHash: Digest,
  versionHash: Digest,
  cacheIdentityHash: Digest.nullable(),
  requiresCacheIdentity: z.boolean(),
});

/** Optional stamps: old records remain readable, but cannot prove observation compatibility. */
export const BlockProvenance = z.strictObject({
  specIndex: z.number().int().min(0),
  stimulusHash: Digest,
  ledgerHash: Digest,
  artifacts: z.array(z.strictObject({ pathHash: Digest, sha256: Digest.nullable() })),
});
export const RunProvenance = z.strictObject({
  version: z.literal(2),
  driver: z.strictObject({ idHash: Digest, seedsHash: Digest.nullable() }),
  adapter: AdapterIdentity,
  agentVersionHash: Digest.nullable(),
  targetVersionHash: Digest.optional(),
  agentVersionLabelHash: Digest.nullable().optional(),
  executionHash: Digest,
});
export const CampaignProvenance = z.strictObject({
  version: z.literal(2),
  adapters: z.array(AdapterIdentity.extend({ targetHash: Digest, agentVersionHash: Digest.nullable() })),
});
