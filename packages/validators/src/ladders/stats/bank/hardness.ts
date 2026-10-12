import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK_LEVELS, type BankItem, statsBank } from './index';
import { runIsolated } from './isolate';

/**
 * The hardness measurement of docs/validators.md section 12.4 for the statistics bank: the bank score (items
 * passing on every seed, over the bank), its split by family, tier and level, and the forecast of iterations to
 * 100 percent from the pilot rows kept in `validators/stats/bank-scores.jsonl` (one row per iteration, 0 first).
 */
export const BANK_SCORES = 'validators/stats/bank-scores.jsonl';

export type SeedLabel = { seed: number; label: string };

export type BankScore = {
  iteration: number;
  at: string;
  commit: string;
  seeds: string[];
  bank: number;
  passing: number;
  score: number;
  failingIds: string[];
  byFamily: Record<string, { items: number; passing: number }>;
  byTier: Record<string, { items: number; passing: number }>;
  byLevel: Record<string, { items: number; passing: number }>;
  /** For each failing item outside the roadmap level, the seeds it failed on and its first message. */
  failingDetails?: Record<string, { seeds: string[]; detail: string }>;
  /** The ladder level per seed: the levels passed in order before the first one with a failing item. */
  levelPerSeed: Record<string, number>;
  /** Distinct causes among the items failing on some seed. */
  failingCauses: number;
  note: string;
};

/** Runs the whole bank on every seed and scores it: an item passes when it passes on every seed. */
export async function scoreBank(
  root: string,
  seeds: readonly SeedLabel[],
  note = '',
): Promise<Omit<BankScore, 'iteration' | 'at' | 'commit'>> {
  const bank = statsBank(root);
  const failing = new Set<string>();
  const levelPerSeed: Record<string, number> = {};
  const failingDetails: Record<string, { seeds: string[]; detail: string }> = {};
  for (const { seed, label } of seeds) {
    const run = await runIsolated(bank, seed, root);
    const failedHere = new Set(bank.filter((item) => !run.get(item.id)?.pass).map((item) => item.id));
    for (const id of failedHere) failing.add(id);
    for (const item of bank) {
      if (item.level === 'roadmap' || !failedHere.has(item.id)) continue;
      const entry = failingDetails[item.id] ?? {
        seeds: [],
        detail: (run.get(item.id)?.detail ?? '').slice(0, 300),
      };
      entry.seeds.push(label);
      failingDetails[item.id] = entry;
    }
    let level = 0;
    for (const name of BANK_LEVELS) {
      if (bank.some((item) => item.level === name && failedHere.has(item.id))) break;
      level += 1;
    }
    levelPerSeed[label] = level;
  }
  const split = (key: (item: BankItem) => string) => {
    const out: Record<string, { items: number; passing: number }> = {};
    for (const item of bank) {
      const k = key(item);
      const entry = out[k] ?? { items: 0, passing: 0 };
      entry.items += 1;
      if (!failing.has(item.id)) entry.passing += 1;
      out[k] = entry;
    }
    return out;
  };
  const passing = bank.length - failing.size;
  const failingCauses = new Set(
    bank.filter((item) => failing.has(item.id)).map((item) => item.cause ?? item.id),
  ).size;
  return {
    failingCauses,
    seeds: seeds.map((s) => s.label),
    bank: bank.length,
    passing,
    score: passing / bank.length,
    failingIds: bank.filter((item) => failing.has(item.id)).map((item) => item.id),
    byFamily: split((item) => item.family),
    byTier: split((item) => String(item.tier)),
    byLevel: split((item) => item.level),
    failingDetails,
    levelPerSeed,
    note,
  };
}

/** The rows of the bank-scores file. */
export function readBankScores(root: string): BankScore[] {
  const path = join(root, BANK_SCORES);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as BankScore);
}

export function appendBankScore(root: string, row: BankScore): void {
  appendFileSync(join(root, BANK_SCORES), `${JSON.stringify(row)}\n`);
}

export type Forecast = {
  iteration0: number;
  afterPilot: number;
  pilotIterations: number;
  fixedPerIteration: number;
  remaining: number;
  forecast: number;
  gate: { forecastAtLeast100: boolean; scoreAtMost04: boolean; holds: boolean };
};

/** Section 12.4: items fixed per iteration is the mean over the pilot; the forecast is remaining over that mean. */
export function forecast(rows: readonly BankScore[]): Forecast | undefined {
  const first = rows.find((row) => row.iteration === 0);
  const last = rows[rows.length - 1];
  if (!first || !last || last.iteration === 0) return undefined;
  const fixed = (last.passing - first.passing) / last.iteration;
  const remaining = last.bank - last.passing;
  const f = fixed > 0 ? remaining / fixed : Number.POSITIVE_INFINITY;
  return {
    iteration0: first.score,
    afterPilot: last.score,
    pilotIterations: last.iteration,
    fixedPerIteration: fixed,
    remaining,
    forecast: f,
    gate: {
      forecastAtLeast100: f >= 100,
      scoreAtMost04: last.score <= 0.4,
      holds: f >= 100 && last.score <= 0.4,
    },
  };
}
