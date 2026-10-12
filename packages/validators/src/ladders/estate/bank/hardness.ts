import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { type BankScore, bankScore, bankShape, type Family } from './frame';

/**
 * The hardness measurement of docs/validators.md section 12.4, kept in `validators/estate/hardness.json`:
 * iteration 0 (the finished bank on seeds 1 to 20 and the hidden seed), then one row per pilot iteration of
 * the executor loop. Each row holds the failing item ids, so the items an iteration fixed (and broke) are
 * computed, not claimed. The forecast is the failing items after the last row over the mean items fixed per
 * pilot iteration; the gate holds when it is at least 100 and the bank score after the pilot is at most 0.4.
 */

export const HARDNESS_FILE = 'validators/estate/hardness.json';
export const FORECAST_GATE = 100;
export const SCORE_GATE = 0.4;

const Row = z.strictObject({
  iteration: z.number().int().min(0),
  at: z.string(),
  commit: z.string(),
  seeds: z.array(z.string()),
  hiddenSeed: z.number().int(),
  size: z.number().int(),
  passing: z.number().int(),
  score: z.number(),
  change: z.string(),
  failing: z.array(z.string()),
  perFamily: z.record(z.string(), z.strictObject({ size: z.number().int(), passing: z.number().int() })),
});
export type HardnessRow = z.infer<typeof Row>;

const File = z.strictObject({ version: z.literal(1), component: z.literal('estate'), rows: z.array(Row) });
export type HardnessFile = z.infer<typeof File>;

export function readHardness(path: string): HardnessFile {
  try {
    return File.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { version: 1, component: 'estate', rows: [] };
  }
}

export function writeHardness(path: string, file: HardnessFile): void {
  writeFileSync(path, `${JSON.stringify(File.parse(file), null, 2)}\n`);
}

/** A row from a bank score. */
export function rowOf(
  score: BankScore,
  meta: {
    iteration: number;
    at: string;
    commit: string;
    seeds: string[];
    hiddenSeed: number;
    change: string;
  },
): HardnessRow {
  const perFamily: HardnessRow['perFamily'] = {};
  for (const item of score.items) {
    const entry = perFamily[item.family] ?? { size: 0, passing: 0 };
    entry.size += 1;
    if (item.pass) entry.passing += 1;
    perFamily[item.family] = entry;
  }
  return {
    ...meta,
    size: score.size,
    passing: score.passing,
    score: score.score,
    failing: score.items
      .filter((item) => !item.pass)
      .map((item) => item.id)
      .sort(),
    perFamily,
  };
}

export type Hardness = {
  size: number;
  families: Record<string, number>;
  tiers: Record<string, number>;
  iteration0?: { score: number; passing: number };
  pilot: Array<{ iteration: number; score: number; fixed: string[]; broke: string[]; change: string }>;
  meanFixed: number;
  remaining: number;
  forecast: number;
  gate: { forecast: boolean; score: boolean; holds: boolean };
};

/** The measurement from the rows: fixed per iteration, the forecast and the gate. */
export function hardness(families: readonly Family[], file: HardnessFile): Hardness {
  const shape = bankShape(families);
  const rows = [...file.rows].sort((a, b) => a.iteration - b.iteration);
  const pilot: Hardness['pilot'] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = new Set((rows[index - 1] as HardnessRow).failing);
    const now = new Set((rows[index] as HardnessRow).failing);
    pilot.push({
      iteration: (rows[index] as HardnessRow).iteration,
      score: (rows[index] as HardnessRow).score,
      fixed: [...before].filter((id) => !now.has(id)),
      broke: [...now].filter((id) => !before.has(id)),
      change: (rows[index] as HardnessRow).change,
    });
  }
  const last = rows.at(-1);
  const remaining = last ? last.failing.length : shape.size;
  const meanFixed =
    pilot.length === 0
      ? 0
      : pilot.reduce((sum, row) => sum + row.fixed.length - row.broke.length, 0) / pilot.length;
  const forecast = meanFixed > 0 ? remaining / meanFixed : Number.POSITIVE_INFINITY;
  const lastScore = last?.score ?? 0;
  return {
    size: shape.size,
    families: shape.families,
    tiers: shape.tiers,
    ...(rows[0] ? { iteration0: { score: rows[0].score, passing: rows[0].passing } } : {}),
    pilot,
    meanFixed,
    remaining,
    forecast,
    gate: {
      // A pilot that fixed nothing gives no forecast, and the gate cannot hold on it (section 12.4 point 6).
      forecast: Number.isFinite(forecast) && forecast >= FORECAST_GATE,
      score: lastScore <= SCORE_GATE,
      holds: Number.isFinite(forecast) && forecast >= FORECAST_GATE && lastScore <= SCORE_GATE,
    },
  };
}

/** The bank on the seeds of a measurement: 1 to 20 and the hidden seed. */
export async function measure(families: readonly Family[], hidden: number, visible = 20): Promise<BankScore> {
  const seeds = [
    ...Array.from({ length: visible }, (_, index) => ({ seed: index + 1, label: String(index + 1) })),
    { seed: hidden, label: 'hidden' },
  ];
  return bankScore(families, seeds);
}

/** The measurement as lines a person reads. */
export function renderHardness(value: Hardness): string {
  const lines = [`Estate bank: ${value.size} items.`];
  lines.push(
    `Families: ${Object.entries(value.families)
      .map(([family, count]) => `${family} ${count}`)
      .join(', ')}.`,
  );
  lines.push(
    `Tiers: ${Object.entries(value.tiers)
      .sort()
      .map(([tier, count]) => `${tier}: ${count}`)
      .join(', ')}.`,
  );
  if (value.iteration0)
    lines.push(
      `Iteration 0: ${value.iteration0.passing} of ${value.size} pass (score ${value.iteration0.score.toFixed(3)}).`,
    );
  for (const row of value.pilot) {
    lines.push(
      `Pilot ${row.iteration}: score ${row.score.toFixed(3)}, fixed ${row.fixed.length}, broke ${row.broke.length}. ${row.change}`,
    );
  }
  lines.push(
    `Items fixed per iteration: ${value.meanFixed.toFixed(2)}. Failing: ${value.remaining}. Forecast: ${Number.isFinite(value.forecast) ? value.forecast.toFixed(1) : 'none (nothing fixed)'} iterations.`,
  );
  lines.push(
    `Gate: forecast at least ${FORECAST_GATE} ${value.gate.forecast ? 'holds' : 'fails'}; score at most ${SCORE_GATE} ${value.gate.score ? 'holds' : 'fails'}.`,
  );
  return `${lines.join('\n')}\n`;
}
