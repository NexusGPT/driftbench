import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { runItem } from './run';
import { type BankDeps, type BankItem, LEVELS } from './types';

/**
 * The hardness measurement of docs/validators.md section 12.4. A bank run scores every item on every seed;
 * an item counts as passing when it passes on all of them. The rows of `validators/map/bank.jsonl` hold
 * iteration 0 and the pilot iterations; the forecast is the failing items left divided by the mean items
 * fixed per pilot iteration, and the gate holds when it is at least 100 and the last score is at most 0.4.
 */

export const BANK_FILE = 'validators/map/bank.jsonl';
export const MIN_BANK = 300;
export const MIN_FAMILY = 20;
export const GATE_FORECAST = 100;
export const GATE_SCORE = 0.4;

export type ItemResult = {
  id: string;
  family: string;
  tier: number;
  level: number;
  pass: boolean;
  failedOn: string[];
};

/** Runs every item on every seed. `failedOn` lists the seeds (labels) where an item failed. */
export async function runBank(
  items: readonly BankItem[],
  seeds: ReadonlyArray<{ seed: number; label: string }>,
  deps: BankDeps = {},
  progress?: (done: number, total: number) => void,
): Promise<ItemResult[]> {
  const out: ItemResult[] = [];
  for (const [index, item] of items.entries()) {
    const failedOn: string[] = [];
    for (const { seed, label } of seeds) {
      const outcome = await runItem(item, seed, deps);
      if (!outcome.pass) failedOn.push(label);
    }
    out.push({
      id: item.id,
      family: item.family,
      tier: item.tier,
      level: item.level,
      pass: failedOn.length === 0,
      failedOn,
    });
    progress?.(index + 1, items.length);
  }
  return out;
}

export const BankRow = z
  .object({
    iteration: z.number().int().min(0),
    at: z.iso.datetime(),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    seeds: z.array(z.string()).min(1),
    total: z.number().int().min(1),
    passing: z.number().int().min(0),
    score: z.number().min(0).max(1),
    level: z.number().int().min(0),
    perFamily: z.record(
      z.string(),
      z.object({ total: z.number().int(), passing: z.number().int() }).strict(),
    ),
    perTier: z.record(z.string(), z.object({ total: z.number().int(), passing: z.number().int() }).strict()),
    perLevel: z.record(z.string(), z.object({ total: z.number().int(), passing: z.number().int() }).strict()),
    failing: z.array(z.string()),
    note: z.string(),
  })
  .strict();
export type BankRow = z.infer<typeof BankRow>;

function tally(results: readonly ItemResult[], key: (result: ItemResult) => string) {
  const out: Record<string, { total: number; passing: number }> = {};
  for (const result of results) {
    const name = key(result);
    const entry = out[name] ?? { total: 0, passing: 0 };
    entry.total += 1;
    if (result.pass) entry.passing += 1;
    out[name] = entry;
  }
  return out;
}

/** The level the bank reaches: the levels passed in order, every item of each passing on every seed. */
export function bankLevel(results: readonly ItemResult[]): number {
  let level = 0;
  for (let index = 1; index <= LEVELS.length; index++) {
    const own = results.filter((result) => result.level === index);
    if (own.some((result) => !result.pass)) break;
    level = index;
  }
  return level;
}

export function bankRow(
  iteration: number,
  commit: string,
  seeds: readonly string[],
  results: readonly ItemResult[],
  note: string,
  at = new Date().toISOString(),
): BankRow {
  const passing = results.filter((result) => result.pass).length;
  return {
    iteration,
    at,
    commit,
    seeds: [...seeds],
    total: results.length,
    passing,
    score: Math.round((passing / results.length) * 10000) / 10000,
    level: bankLevel(results),
    perFamily: tally(results, (result) => result.family),
    perTier: tally(results, (result) => String(result.tier)),
    perLevel: tally(results, (result) => String(result.level)),
    failing: results.filter((result) => !result.pass).map((result) => result.id),
    note,
  };
}

export function readBankRows(root: string): BankRow[] {
  const path = join(root, BANK_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => BankRow.parse(JSON.parse(line)));
}

export function appendBankRow(root: string, row: BankRow): void {
  const rows = readBankRows(root);
  const last = rows.at(-1);
  if (last && row.iteration !== last.iteration + 1) {
    throw new Error(`the next bank row is iteration ${last.iteration + 1}, not ${row.iteration}`);
  }
  if (!last && row.iteration !== 0) throw new Error('the first bank row is iteration 0');
  appendFileSync(join(root, BANK_FILE), `${JSON.stringify(BankRow.parse(row))}\n`);
}

export type Forecast = {
  iterations: number;
  scoreAtZero: number;
  scoreNow: number;
  fixedPerIteration: number;
  remaining: number;
  forecast: number;
  gate: boolean;
  reasons: string[];
};

/** The forecast and the gate from the bank rows: iteration 0 then the pilot. */
export function forecast(rows: readonly BankRow[]): Forecast | undefined {
  const zero = rows.find((row) => row.iteration === 0);
  const last = rows.at(-1);
  if (!zero || !last) return undefined;
  const pilot = rows.filter((row) => row.iteration > 0);
  const fixed = pilot.length === 0 ? 0 : (last.passing - zero.passing) / pilot.length;
  const remaining = last.total - last.passing;
  const value = fixed > 0 ? remaining / fixed : Number.POSITIVE_INFINITY;
  const reasons: string[] = [];
  if (value < GATE_FORECAST) reasons.push(`the forecast ${value.toFixed(1)} is under ${GATE_FORECAST}`);
  if (last.score > GATE_SCORE) reasons.push(`the score ${last.score} is over ${GATE_SCORE}`);
  if (pilot.length < 10) reasons.push(`the pilot has ${pilot.length} iterations, not 10`);
  if (fixed === 0 && pilot.length > 0)
    reasons.push('the pilot fixed nothing: report the items to the maintainer');
  return {
    iterations: pilot.length,
    scoreAtZero: zero.score,
    scoreNow: last.score,
    fixedPerIteration: Math.round(fixed * 100) / 100,
    remaining,
    forecast: Number.isFinite(value) ? Math.round(value * 10) / 10 : value,
    gate: reasons.length === 0,
    reasons,
  };
}

/** The bank's shape against section 12.1: size, families, tiers. Returns the problems. */
export function bankShape(items: readonly BankItem[]): string[] {
  const problems: string[] = [];
  if (items.length < MIN_BANK) problems.push(`the bank holds ${items.length} items, under ${MIN_BANK}`);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) problems.push(`the id ${item.id} is used twice`);
    ids.add(item.id);
  }
  const families = new Map<string, number>();
  for (const item of items) families.set(item.family, (families.get(item.family) ?? 0) + 1);
  for (const [family, count] of families) {
    if (count < MIN_FAMILY) problems.push(`the family ${family} holds ${count} items, under ${MIN_FAMILY}`);
  }
  for (const tier of [1, 2, 3, 4, 5]) {
    if (!items.some((item) => item.tier === tier)) problems.push(`no item of tier ${tier}`);
  }
  return problems;
}

/** The measurement as a person reads it: bank per family and tier, scores, fixed per iteration, forecast. */
export function formatHardness(items: readonly BankItem[], rows: readonly BankRow[]): string {
  const lines: string[] = [];
  const families = new Map<string, Map<number, number>>();
  for (const item of items) {
    const tiers = families.get(item.family) ?? new Map<number, number>();
    tiers.set(item.tier, (tiers.get(item.tier) ?? 0) + 1);
    families.set(item.family, tiers);
  }
  const last = rows.at(-1);
  lines.push(`Bank: ${items.length} items in ${families.size} families.`);
  lines.push('Family                 Items  Tier 1  Tier 2  Tier 3  Tier 4  Tier 5  Passing now');
  for (const [family, tiers] of [...families].sort(([a], [b]) => a.localeCompare(b))) {
    const count = [...tiers.values()].reduce((sum, n) => sum + n, 0);
    const now = last?.perFamily[family];
    lines.push(
      `${family.padEnd(22)} ${String(count).padStart(5)}  ${[1, 2, 3, 4, 5]
        .map((tier) => String(tiers.get(tier) ?? 0).padStart(6))
        .join('  ')}  ${now ? `${now.passing} of ${now.total}` : 'not run'}`,
    );
  }
  const shape = bankShape(items);
  lines.push(
    shape.length === 0
      ? 'Shape: at least 300 items, every family 20 or more, every tier present.'
      : `Shape problems: ${shape.join('; ')}.`,
  );
  for (const row of rows) {
    lines.push(
      `Iteration ${row.iteration} at ${row.commit.slice(0, 7)}: ${row.passing} of ${row.total} passing on ${row.seeds.length} seeds, score ${row.score}, level ${row.level}. ${row.note}`,
    );
  }
  const measured = forecast(rows);
  if (!measured) {
    lines.push('No iteration 0 row yet.');
  } else {
    lines.push(
      `Score at iteration 0: ${measured.scoreAtZero}. Score now: ${measured.scoreNow}. Items fixed per pilot iteration: ${measured.fixedPerIteration} over ${measured.iterations} iterations. Failing items left: ${measured.remaining}. Forecast: ${measured.forecast} iterations.`,
    );
    lines.push(measured.gate ? 'Gate: holds.' : `Gate: does not hold (${measured.reasons.join('; ')}).`);
  }
  return lines.join('\n');
}
