/**
 * Turns a bank measurement (bank-run.ts output) into a journal row for `driftbench validate generator
 * --journal` (docs/validators.md sections 10.2 and 12.4):
 *
 *   node --import tsx packages/validators/src/ladders/generator/bank-row.ts <after.json> <out.json> \
 *     --iteration n [--before <before.json>] --hypothesis "..." [--files a,b] [--commit sha] \
 *     [--tests "t1|t2"] [--minutes n] [--tokens n] [--model opus]
 *
 * Iteration 0 is the baseline: before equals after. The row's metrics are each level's share of items
 * passing on every seed; its bank fields are the size, the items passing on every seed, the failing items
 * per family and the items per family and tier.
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Summary = {
  seeds: string[];
  size: number;
  passing: number;
  shape: Record<string, Record<string, number>>;
  levels: Array<{ id: string; name: string; items: number; passing: number }>;
  perSeedLevels: Array<{ seed: string; level: number }>;
  items: Array<{ id: string; family: string; pass: boolean }>;
};

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const after = JSON.parse(readFileSync(args[0] as string, 'utf8')) as Summary;
const beforePath = option('--before');
const before = beforePath ? (JSON.parse(readFileSync(beforePath, 'utf8')) as Summary) : after;
const iteration = Number(option('--iteration') ?? '0');
const min = (summary: Summary) => Math.min(...summary.perSeedLevels.map((entry) => entry.level));
const failingByFamily: Record<string, number> = {};
for (const item of after.items)
  failingByFamily[item.family] = (failingByFamily[item.family] ?? 0) + (item.pass ? 0 : 1);
const levelBefore = min(before);
const levelAfter = min(after);
const result =
  iteration === 0
    ? 'baseline'
    : levelAfter > levelBefore
      ? 'raised'
      : levelAfter < levelBefore
        ? 'lowered'
        : 'unchanged';
const row = {
  iteration,
  at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  model: option('--model') ?? 'opus',
  seeds: after.seeds,
  command:
    'node --import tsx packages/validators/src/ladders/generator/bank-run.ts <out> --seeds 1..20 --hidden',
  level: { before: levelBefore, after: levelAfter },
  perSeed: after.perSeedLevels.map((entry) => ({
    seed: entry.seed,
    before: before.perSeedLevels.find((other) => other.seed === entry.seed)?.level ?? entry.level,
    after: entry.level,
  })),
  metrics: after.levels.map((level, index) => ({
    level: index + 1,
    id: level.id,
    metric: `items passing on every seed / items of the level (${level.items})`,
    threshold: 1,
    before: (before.levels[index]?.passing ?? level.passing) / level.items,
    after: level.passing / level.items,
  })),
  bankSize: after.size,
  passing: after.passing,
  failingByFamily,
  bankByFamilyTier: after.shape,
  failingBefore: before.items.filter((item) => !item.pass).map((item) => item.id),
  hypothesis: option('--hypothesis') ?? 'Iteration 0: the bank measured before any fix.',
  research: null,
  change: {
    files: (option('--files') ?? '').split(',').filter((file) => file !== ''),
    commit: option('--commit') ?? null,
  },
  testsAdded: (option('--tests') ?? '').split('|').filter((test) => test !== ''),
  result,
  durationMinutes: Number(option('--minutes') ?? '0'),
  tokenEstimate: Number(option('--tokens') ?? '0'),
};
writeFileSync(args[1] as string, `${JSON.stringify(row)}\n`);
process.stdout.write(
  `row ${iteration}: ${after.passing} of ${after.size} pass, level ${levelBefore} to ${levelAfter}\n`,
);
