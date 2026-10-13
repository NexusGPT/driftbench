import { z } from 'zod';
import { Stimulus } from './spec';

/** Optional stamps: old records remain readable, but cannot prove observation compatibility. */
export const BlockProvenance = z.strictObject({
  specIndex: z.number().int().min(0),
  stimulus: Stimulus,
  ledgerHash: z.string().min(1),
  artifacts: z.array(z.strictObject({ path: z.string(), sha256: z.string().nullable() })),
});
export const RunProvenance = z.strictObject({
  driver: z.strictObject({
    id: z.string(),
    seeds: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
  }),
  adapter: z.strictObject({ id: z.string(), version: z.string() }),
  executionHash: z.string().min(1),
});
export const CampaignProvenance = z.strictObject({
  version: z.literal(1),
  adapters: z.array(
    z.strictObject({
      target: z.string(),
      id: z.string(),
      version: z.string(),
      agentVersion: z.string().nullable(),
    }),
  ),
});
