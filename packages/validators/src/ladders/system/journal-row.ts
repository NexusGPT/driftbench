/**
 * Builds a journal row (docs/validators.md sections 10.2 and 12.4) from two `driftbench validate system
 * --seeds 1..20 --hidden --items --json` runs, before and after an iteration, so nothing is copied by hand:
 *
 *   pnpm -s exec tsx packages/validators/src/ladders/system/journal-row.ts --before before.json \
 *     --after after.json --iteration 3 --hypothesis "..." --files a,b --commit <sha> --minutes 12 > row.json
 *   pnpm -s driftbench validate system --journal row.json
 *
 * Iteration 0 takes the same file as before and after. `result` follows the level: baseline for iteration 0,
 * raised or lowered when the level moved, unchanged otherwise.
 */
import { readFileSync } from 'node:fs';

type Row = { level: number; id: string; metric: string; threshold: number; observed: number | null };
type SeedRun = {
  seed: number;
  hidden: boolean;
  level: number;
  rows: Row[];
  failing: { items: { id: string }[] } | null;
};
type Report = {
  level: number;
  seeds: SeedRun[];
  bank: {
    size: number;
    passing: number;
    failingCauses?: number;
    failingWithoutCause?: number;
    failingByFamily: Record<string, number>;
    byFamilyTier: Record<string, Record<string, number>>;
    rows: { id: string; passEverySeed: boolean }[];
  };
};

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const read = (path: string | undefined): Report => {
  if (!path) throw new Error('give --before and --after');
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Report | { reports: Report[] };
  return 'reports' in doc ? (doc.reports[0] as Report) : doc;
};

const before = read(option('--before'));
const after = read(option('--after'));
const label = (run: SeedRun) => (run.hidden ? 'hidden' : String(run.seed));
const iteration = Number(option('--iteration') ?? '0');
const levelBefore = Math.min(...before.seeds.map((run) => run.level));
const levelAfter = Math.min(...after.seeds.map((run) => run.level));
const first = (report: Report) => report.seeds[0]?.rows ?? [];
const row = {
  iteration,
  at: new Date().toISOString(),
  model: option('--model') ?? 'opus',
  seeds: after.seeds.map(label),
  command: 'pnpm driftbench validate system --seeds 1..20 --hidden --items --json',
  level: { before: levelBefore, after: levelAfter },
  perSeed: after.seeds.map((run, index) => ({
    seed: label(run),
    before: before.seeds[index]?.level ?? 0,
    after: run.level,
  })),
  metrics: first(after).map((entry, index) => ({
    level: entry.level,
    id: entry.id,
    metric: entry.metric,
    threshold: entry.threshold,
    before: first(before)[index]?.observed ?? null,
    after: entry.observed,
  })),
  bankSize: after.bank.size,
  passing: after.bank.passing,
  failingByFamily: after.bank.failingByFamily,
  ...(after.bank.failingCauses === undefined
    ? {}
    : { failingCauses: after.bank.failingCauses, failingWithoutCause: after.bank.failingWithoutCause ?? 0 }),
  bankByFamilyTier: after.bank.byFamilyTier,
  failingBefore: before.bank.rows.filter((entry) => !entry.passEverySeed).map((entry) => entry.id),
  hypothesis: option('--hypothesis') ?? 'Iteration 0: the bank measured before any fix.',
  research: null,
  change: { files: (option('--files') ?? '').split(',').filter(Boolean), commit: option('--commit') ?? null },
  testsAdded: (option('--tests') ?? '').split(';').filter(Boolean),
  result:
    iteration === 0
      ? 'baseline'
      : levelAfter > levelBefore
        ? 'raised'
        : levelAfter < levelBefore
          ? 'lowered'
          : 'unchanged',
  durationMinutes: Number(option('--minutes') ?? '0'),
  tokenEstimate: Number(option('--tokens') ?? '0'),
};
process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
