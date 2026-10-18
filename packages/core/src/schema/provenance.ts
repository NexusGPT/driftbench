import { z } from 'zod';

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const AdapterIdentity = z.strictObject({
  idHash: Digest,
  versionHash: Digest,
  cacheIdentityHash: Digest.nullable(),
  requiresCacheIdentity: z.boolean(),
});

export const EndStateSnapshot = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unavailable') }),
  z.strictObject({
    kind: z.literal('read'),
    values: z.array(
      z.discriminatedUnion('kind', [
        z.strictObject({ source: z.string(), kind: z.literal('undefined') }),
        z.strictObject({ source: z.string(), kind: z.literal('value'), value: z.unknown() }),
      ]),
    ),
  }),
]);

/** Optional stamps: old records remain readable, but cannot prove observation compatibility. */
export const BlockProvenance = z.strictObject({
  endState: EndStateSnapshot.optional(),
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
  endStateSnapshots: z.literal(true).optional(),
  /** The campaign stores the text a driver sent where it differs from the spec (`realized.text`). */
  realizedText: z.literal(true).optional(),
  adapters: z.array(AdapterIdentity.extend({ targetHash: Digest, agentVersionHash: Digest.nullable() })),
});

/** Both pinned full specs plus the proof that their agent-facing execution is compatible. */
export const RejudgedFrom = z.strictObject({
  fromCampaign: z.string(),
  fromRun: z.string(),
  oldSpecHash: z.string(),
  newSpecHash: z.string(),
  compatibilityHash: z.string(),
  criteria: z.array(z.string()),
  judgedAt: z.string(),
  judgeCostUsd: z.number().nonnegative().optional(),
});
