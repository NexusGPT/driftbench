import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { type BankItem, countBy } from './bank/index';

/**
 * The hardness measurement of docs/validators.md section 12.4, for the system bank. One row per measured
 * iteration: iteration 0 (the finished bank on seeds 1 to 20 and the hidden seed), then one row per pilot
 * iteration. The bank score is the share of items passing on every seed. The forecast is the remaining
 * failing items over the mean items fixed per pilot iteration; the gate holds when the forecast is at least
 * 100 and the score after the pilot is at most 0.4.
 *
 * The frame's journal row (packages/validators/src/journal.ts) starts at iteration 1 and has no field for a
 * bank score, so the rows live in validators/system/hardness.jsonl beside the journal; the pilot iterations
 * are also journal rows. The handoff proposes the frame change that moves this into the journal.
 */

export const HARDNESS_FILE = 'validators/system/hardness.jsonl';
export const FORECAST_GATE = 100;
export const SCORE_GATE = 0.4;

const Tally = z.object({ size: z.number().int().min(0), passing: z.number().int().min(0) }).strict();

export const HardnessRow = z
  .object({
    iteration: z.number().int().min(0),
    at: z.iso.datetime(),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    seeds: z.array(z.string().regex(/^(\d+|hidden)$/)).min(1),
    hiddenSeed: z.number().int().nullable(),
    bank: z.number().int().min(0),
    passing: z.number().int().min(0),
    score: z.number().min(0).max(1),
    perFamily: z.record(z.string(), Tally),
    perTier: z.record(z.string(), Tally),
    perLevel: z.record(z.string(), Tally),
    /** Items failing on at least one seed, by id. */
    failing: z.array(z.string()),
    /** What the iteration changed in the component, and the commit; null for iteration 0. */
    change: z
      .object({ summary: z.string().min(1), files: z.array(z.string()), commit: z.string().nullable() })
      .strict()
      .nullable(),
    durationMinutes: z.number().min(0),
  })
  .strict();
export type HardnessRow = z.infer<typeof HardnessRow>;

/** Item results over seeds: an item passes the bank when it passes on every seed. */
export type BankRun = { seeds: string[]; results: Map<string, Map<string, boolean>> };

export function tallyRow(
  items: readonly BankItem[],
  run: BankRun,
  meta: Pick<HardnessRow, 'iteration' | 'at' | 'commit' | 'hiddenSeed' | 'change' | 'durationMinutes'>,
): HardnessRow {
  const passes = (item: BankItem) => run.seeds.every((seed) => run.results.get(item.id)?.get(seed) === true);
  const tally = (key: (item: BankItem) => string | number) => {
    const out: Record<string, { size: number; passing: number }> = {};
    for (const [name, size] of countBy(items, key)) out[name] = { size, passing: 0 };
    for (const item of items) if (passes(item)) (out[String(key(item))] as { passing: number }).passing += 1;
    return out;
  };
  const passing = items.filter(passes).length;
  return HardnessRow.parse({
    ...meta,
    seeds: run.seeds,
    bank: items.length,
    passing,
    score: items.length === 0 ? 0 : passing / items.length,
    perFamily: tally((item) => item.family),
    perTier: tally((item) => item.tier),
    perLevel: tally((item) => item.level),
    failing: items.filter((item) => !passes(item)).map((item) => item.id),
  });
}

export function readHardness(root: string): HardnessRow[] {
  const path = join(root, HARDNESS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => HardnessRow.parse(JSON.parse(line)));
}

export function appendHardness(root: string, row: HardnessRow): void {
  const rows = readHardness(root);
  const expected = rows.length === 0 ? 0 : (rows.at(-1)?.iteration ?? -1) + 1;
  if (row.iteration !== expected)
    throw new Error(`the next hardness row is iteration ${expected}, not ${row.iteration}`);
  const path = join(root, HARDNESS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(HardnessRow.parse(row))}\n`);
}

export type Forecast = {
  iteration0: { bank: number; passing: number; score: number } | undefined;
  afterPilot: { iteration: number; bank: number; passing: number; score: number } | undefined;
  pilotIterations: number;
  /** Net items fixed per pilot iteration: failing at iteration 0 minus failing at the last row, over the iterations. */
  fixedPerIteration: number | undefined;
  remaining: number | undefined;
  forecast: number | undefined;
  gate: { forecast: boolean; score: boolean; holds: boolean };
};

/** The section 12.4 measurement from the hardness rows. A pilot that fixed nothing forecasts no end. */
export function forecastOf(rows: readonly HardnessRow[]): Forecast {
  const first = rows.find((row) => row.iteration === 0);
  const last = rows.at(-1);
  const iterations = last ? last.iteration : 0;
  const fixed =
    first && last && iterations > 0
      ? (first.bank - first.passing - (last.bank - last.passing)) / iterations
      : undefined;
  const remaining = last ? last.bank - last.passing : undefined;
  const forecast =
    fixed === undefined || remaining === undefined
      ? undefined
      : fixed <= 0
        ? Number.POSITIVE_INFINITY
        : remaining / fixed;
  const forecastOk = forecast !== undefined && forecast >= FORECAST_GATE;
  const scoreOk = last !== undefined && iterations > 0 && last.score <= SCORE_GATE;
  return {
    iteration0: first ? { bank: first.bank, passing: first.passing, score: first.score } : undefined,
    afterPilot:
      last && iterations > 0
        ? { iteration: last.iteration, bank: last.bank, passing: last.passing, score: last.score }
        : undefined,
    pilotIterations: iterations,
    fixedPerIteration: fixed,
    remaining,
    forecast,
    gate: { forecast: forecastOk, score: scoreOk, holds: forecastOk && scoreOk },
  };
}

/** The measurement as text: bank per family and tier, the scores, the forecast and the gate. */
export function formatHardness(rows: readonly HardnessRow[]): string {
  const last = rows.at(-1);
  if (!last) return 'No hardness row yet.';
  const f = forecastOf(rows);
  const lines = [
    `System bank: ${last.bank} items, ${last.passing} passing on every seed (score ${last.score.toFixed(3)}), iteration ${last.iteration}.`,
  ];
  lines.push('Family                      Size  Passing');
  for (const [family, tally] of Object.entries(last.perFamily).sort())
    lines.push(
      `${family.padEnd(26)}  ${String(tally.size).padStart(4)}  ${String(tally.passing).padStart(7)}`,
    );
  lines.push(
    `Tiers: ${Object.entries(last.perTier)
      .map(([tier, tally]) => `${tier}: ${tally.passing}/${tally.size}`)
      .join(', ')}`,
  );
  lines.push(
    `Iteration 0: ${f.iteration0 ? `${f.iteration0.passing}/${f.iteration0.bank} (score ${f.iteration0.score.toFixed(3)})` : 'none'}.`,
  );
  lines.push(
    `Scores by iteration: ${rows.map((row) => `${row.iteration}: ${row.score.toFixed(3)}`).join(', ')}.`,
  );
  lines.push(
    `Pilot: ${f.pilotIterations} iterations, ${f.fixedPerIteration === undefined ? 'no' : f.fixedPerIteration.toFixed(2)} items fixed per iteration, ${f.remaining} failing, forecast ${f.forecast === undefined ? 'none' : Number.isFinite(f.forecast) ? f.forecast.toFixed(1) : 'no end'} iterations.`,
  );
  lines.push(
    `Gate: forecast at least ${FORECAST_GATE} ${f.gate.forecast ? 'holds' : 'FAILS'}; score at most ${SCORE_GATE} ${f.gate.score ? 'holds' : 'FAILS'}.`,
  );
  return lines.join('\n');
}
