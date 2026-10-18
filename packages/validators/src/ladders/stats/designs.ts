import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The planted designs of the simulation levels 3 to 6, as data. The thresholds stay in the ladder source; the
 * designs say what is planted: the clusters and their correlation, the nested variance shares, the population
 * of classes and its tail, the campaigns whose power is planned.
 */
export const STATS_DESIGNS = 'packages/validators/fixtures/stats/designs.json';

const Probability = z.number().min(0).max(1);
const Count = z.number().int().min(1);
const Id = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/);

const SharesSchema = z.strictObject({
  datasets: Count,
  cells: z.number().int().min(2),
  conversations: z.number().int().min(2),
  wordings: z.number().int().min(2),
  repeats: z.number().int().min(2),
  logitMean: z.number(),
  logitSd: z.strictObject({
    cell: z.number().min(0),
    conversation: z.number().min(0),
    wording: z.number().min(0),
  }),
});

export const StatsDesignsSchema = z.strictObject({
  version: z.literal(1),
  clustered: z.strictObject({
    draws: Count,
    rates: z.strictObject({ low: Probability, high: Probability }),
    designs: z
      .array(
        z.strictObject({
          id: Id,
          clusters: z.number().int().min(2),
          size: z.number().int().min(2),
          rho: Probability,
        }),
      )
      .min(1),
  }),
  shares: SharesSchema,
  // A second shares design where the nested subtraction is large: wordings carry most of the spread.
  sharesNested: SharesSchema,
  unseen: z.strictObject({
    draws: Count,
    warningDraws: Count,
    populations: z
      .array(z.strictObject({ id: Id, classes: z.number().int().min(2), spread: z.number().min(1) }))
      .min(1),
    above: z.array(z.number().gt(1)).min(1),
    below: z.array(z.number().gt(0).lt(1)).min(1),
  }),
  power: z.strictObject({
    draws: Count,
    alpha: Probability,
    designs: z
      .array(
        z.strictObject({
          id: Id,
          n: Count,
          repeats: Count,
          baselineRate: Probability,
          power: Probability,
          rho: Probability,
        }),
      )
      .min(1),
  }),
});

export type StatsDesigns = z.infer<typeof StatsDesignsSchema>;
export type ClusteredDesigns = StatsDesigns['clustered'];
export type SharesDesign = StatsDesigns['shares'];
export type UnseenDesigns = StatsDesigns['unseen'];
export type PowerDesigns = StatsDesigns['power'];

/** Reads and checks the designs file. Throws naming the first problem. */
export function readDesigns(path: string): StatsDesigns {
  const parsed = StatsDesignsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new TypeError(
      `${path}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'is not a designs file'}`,
    );
  }
  return parsed.data;
}

/** The designs file under a repository root. */
export function designsPath(root: string): string {
  return join(root, STATS_DESIGNS);
}
