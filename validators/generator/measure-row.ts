/**
 * Builds a journal row (docs/validators.md sections 10.2 and 12.4) from two `driftbench validate generator
 * --seeds 1..20 --hidden --items --json` runs, before and after an iteration, so nothing is copied by hand:
 *
 *   pnpm -s exec tsx validators/generator/measure-row.ts --before before.json --after after.json --iteration 0 \
 *     --model "<model>" --executor builder --commit <sha> --hypothesis "..." > row.json
 *   pnpm -s driftbench validate generator --journal row.json
 *
 * Iteration 0 takes the same file as before and after. This projects the actual product report; it does not
 * substitute a reference implementation or reset the historical journal.
 */
import { readFileSync } from 'node:fs';
import { JournalRowSchema } from '../../packages/validators/src/journal';

type Row = { level: number; id: string; metric: string; threshold: number; observed: number | null };
type SeedRun = { seed: number; hidden: boolean; level: number; rows: Row[] };
type Report = {
  component: string;
  level: number;
  seeds: SeedRun[];
  bank: {
    size: number;
    passing: number;
    failingCauses?: number;
    failingComposite?: number;
    catch?: { size: number; passing: number };
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
  const report = 'reports' in doc ? doc.reports.find((entry) => entry.component === 'generator') : doc;
  if (report?.component !== 'generator' || !report.bank || !report.seeds.length) {
    throw new Error('Expected a generator --items --all-levels --json report');
  }
  return report;
};

const before = read(option('--before'));
const after = read(option('--after'));
const label = (run: SeedRun) => (run.hidden ? 'hidden' : String(run.seed));
const iteration = Number(option('--iteration') ?? '0');
const levelBefore = Math.min(...before.seeds.map((run) => run.level));
const levelAfter = Math.min(...after.seeds.map((run) => run.level));
const first = (report: Report) => report.seeds[0]?.rows ?? [];
const executor = option('--executor') ?? 'builder';
if (executor !== 'builder' && executor !== 'blind') throw new Error('--executor takes builder or blind');
const beforeBySeed = new Map(before.seeds.map((run) => [label(run), run]));
if (
  beforeBySeed.size !== before.seeds.length ||
  new Set(after.seeds.map(label)).size !== after.seeds.length ||
  beforeBySeed.size !== after.seeds.length ||
  after.seeds.some((run) => !beforeBySeed.has(label(run)))
) {
  throw new Error('Before and after must measure the same seed labels without duplicates');
}
const beforeMetrics = new Map(first(before).map((entry) => [entry.id, entry]));
const row = {
  iteration,
  at: new Date().toISOString(),
  model: option('--model') ?? 'unrecorded',
  ...(executor === 'builder' || executor === 'blind' ? { executor } : {}),
  seeds: after.seeds.map(label),
  command: 'pnpm driftbench validate generator --reports generator-reports --items --all-levels --json',
  level: { before: levelBefore, after: levelAfter },
  perSeed: after.seeds.map((run) => ({
    seed: label(run),
    before: beforeBySeed.get(label(run))?.level ?? 0,
    after: run.level,
  })),
  metrics: first(after).map((entry) => ({
    level: entry.level,
    id: entry.id,
    metric: entry.metric,
    threshold: entry.threshold,
    before: beforeMetrics.get(entry.id)?.observed ?? null,
    after: entry.observed,
  })),
  bankSize: after.bank.size,
  passing: after.bank.passing,
  failingByFamily: after.bank.failingByFamily,
  ...(after.bank.failingCauses === undefined
    ? {}
    : { failingCauses: after.bank.failingCauses, failingWithoutCause: after.bank.failingWithoutCause ?? 0 }),
  ...(after.bank.failingComposite === undefined ? {} : { failingComposite: after.bank.failingComposite }),
  ...(after.bank.catch === undefined
    ? {}
    : { catchItems: { size: after.bank.catch.size, passing: after.bank.catch.passing } }),
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
process.stdout.write(`${JSON.stringify(JournalRowSchema.parse(row), null, 2)}\n`);
