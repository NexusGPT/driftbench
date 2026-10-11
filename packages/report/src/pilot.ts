import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ReportInputError } from './data';

/**
 * The part of a `driftbench pilot` report (pilot-report.json) the scorecard renders. The pilot package
 * owns the full shape; this schema reads only the fields shown and lets every other field through.
 */
const Bounds = z.looseObject({ lower: z.number(), upper: z.number() });

const Level = z.looseObject({
  level: z.string(),
  groups: z.number().optional(),
  share: z.number(),
  estimable: z.boolean().optional(),
  shareInterval: Bounds.optional(),
});

const PilotCell = z.looseObject({
  cell: z.string(),
  conversations: z.number(),
  runs: z.number(),
  passRate: z.number(),
  passInterval: Bounds.optional(),
  wording: z.looseObject({ maxRange: z.number().optional(), flagged: z.boolean().optional() }).optional(),
  flip: z.looseObject({ mean: z.number() }).optional(),
  allocation: z.looseObject({ allocated: z.number() }).optional(),
});

export const PilotReport = z.looseObject({
  generator: z.string().optional(),
  campaignId: z.string(),
  createdAt: z.string().optional(),
  target: z.looseObject({ adapter: z.string(), agent: z.string().optional() }),
  design: z.looseObject({
    conversations: z.number(),
    repeats: z.number(),
    wordings: z.number(),
    cells: z.number(),
    conversationsRun: z.number().optional(),
    variants: z.number().optional(),
  }),
  analysis: z.looseObject({
    observations: z.number(),
    errored: z.number().optional(),
    passRate: z.looseObject({ estimate: z.number(), interval: Bounds.optional() }),
    pooled: z.looseObject({
      levels: z.array(Level),
      icc: z.array(z.looseObject({ level: z.string(), icc: z.number() })).optional(),
    }),
    designEffect: z.looseObject({ m: z.number(), rho: z.number(), value: z.number() }).optional(),
    noiseFloor: z
      .looseObject({
        floor: z.number(),
        variance: z.number(),
        perBlock: z.looseObject({ repeats: z.number(), floor: z.number() }).optional(),
        perCell: z.looseObject({ blocks: z.number(), repeats: z.number(), floor: z.number() }).optional(),
        reached: z.number().optional(),
      })
      .optional(),
    flip: z.looseObject({ blocks: z.number(), mean: z.number(), flipping: z.number() }).optional(),
    wording: z.looseObject({ threshold: z.number(), q: z.number(), flagged: z.array(z.string()) }).optional(),
    cells: z.array(PilotCell),
  }),
});
export type PilotReport = z.infer<typeof PilotReport>;

/**
 * Reads a pilot report: a pilot-report.json file, or a folder holding one. Throws ReportInputError when it is
 * missing or is not a pilot report.
 */
export function readPilotReport(path: string): PilotReport {
  let file = path;
  if (existsSync(path) && statSync(path).isDirectory()) file = join(path, 'pilot-report.json');
  if (!existsSync(file)) throw new ReportInputError(`No pilot report at ${file}.`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new ReportInputError(
      `${file} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const parsed = PilotReport.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ReportInputError(
      `${file} is not a pilot report: ${issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'unknown shape'}`,
    );
  }
  return parsed.data;
}
