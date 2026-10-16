/**
 * The bank summary of a sweep run as one job per seed (docs/validators.md section 10), in the shape
 * `bank-run.ts` writes and `bank-row.ts` reads:
 *
 *   node --import tsx packages/validators/src/ladders/generator/sweep-summary.ts <out.json> <report.json>...
 *
 * Each report is one job's `driftbench validate generator --all-levels --json`. A job can hold several seeds
 * (the hidden-seed job also runs seed 1), so every seed and every failure is read from the report itself:
 * a seed from the report's `seeds`, a failure from the seeds its `failingItems` entry names, never from the
 * job's name. A seed measured by two jobs is kept once, from the job that holds the fewest seeds; the two
 * runs must agree on its level.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BANK_LEVELS, type BankItem, bankItems, bankShape, causeOf } from './bank';

export type SweepReport = {
  component: string;
  ladderVersion?: number;
  level: number;
  top: number;
  seeds: Array<{ seed: number; hidden: boolean; level: number }>;
  failingItems?: Array<{ id: string; detail: string; seeds: string[]; cause?: string }>;
  hiddenSeed?: { seed: number; source: string; head?: string };
};

type ItemShape = Pick<BankItem, 'id' | 'family' | 'tier' | 'level' | 'component' | 'cause'>;

const labelOf = (seed: { seed: number; hidden: boolean }) => (seed.hidden ? 'hidden' : String(seed.seed));
const order = (label: string) => (label === 'hidden' ? Number.POSITIVE_INFINITY : Number(label));

export function summariseSweep(
  reports: readonly SweepReport[],
  bank: { items: readonly ItemShape[]; levels: ReadonlyArray<{ id: string; name: string }> } = {
    items: bankItems(),
    levels: BANK_LEVELS,
  },
) {
  const components = new Set(reports.map((report) => report.component));
  if (components.size !== 1 || !components.has('generator'))
    throw new Error(
      `the reports are of ${[...components].join(', ') || 'nothing'}, not of the generator alone`,
    );
  // Each seed from the report that holds the fewest seeds; a second measurement must give the same level.
  const owner = new Map<string, { report: SweepReport; level: number }>();
  const byFewest = [...reports].sort((a, b) => a.seeds.length - b.seeds.length);
  for (const report of byFewest) {
    for (const seed of report.seeds) {
      const label = labelOf(seed);
      const held = owner.get(label);
      if (held && held.level !== seed.level)
        throw new Error(`seed ${label} is at level ${held.level} in one report and ${seed.level} in another`);
      if (!held) owner.set(label, { report, level: seed.level });
    }
  }
  const labels = [...owner.keys()].sort((a, b) => order(a) - order(b));
  const failing = new Map<string, Map<string, { detail: string; cause?: string }>>();
  for (const label of labels) {
    const { report } = owner.get(label) as { report: SweepReport };
    const own = new Map<string, { detail: string; cause?: string }>();
    for (const entry of report.failingItems ?? [])
      if (entry.seeds.includes(label))
        own.set(entry.id, { detail: entry.detail, ...(entry.cause ? { cause: entry.cause } : {}) });
    failing.set(label, own);
  }
  const known = new Set(bank.items.map((item) => item.id));
  const unknown = [...failing.values()].flatMap((own) => [...own.keys()]).filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new Error(`failing items not in the bank: ${[...new Set(unknown)].join(', ')}`);
  const items = bank.items.map((item) => {
    const failed = labels.flatMap((label) => {
      const found = failing.get(label)?.get(item.id);
      return found ? [{ label, ...found }] : [];
    });
    return {
      id: item.id,
      family: item.family,
      tier: item.tier,
      level: item.level,
      component: item.component,
      pass: failed.length === 0,
      failedOn: failed.map((entry) => entry.label),
      detail: failed[0]?.detail ?? 'passes on every seed',
      causes: [
        ...new Set(
          failed.map(
            (entry) =>
              entry.cause ??
              causeOf(
                item as BankItem,
                { pass: false, detail: entry.detail } as Parameters<typeof causeOf>[1],
              ),
          ),
        ),
      ],
    };
  });
  const levels = bank.levels
    .filter((level) => bank.items.some((item) => item.level === level.id))
    .map((level) => {
      const own = bank.items.filter((item) => item.level === level.id);
      return {
        id: level.id,
        name: level.name,
        items: own.length,
        passing: items.filter((entry) => entry.level === level.id && entry.pass).length,
        perSeed: labels.map((label) => own.every((item) => !failing.get(label)?.has(item.id))),
      };
    });
  const perSeedLevels = labels.map((label, index) => {
    let level = 0;
    for (const entry of levels) {
      if (!entry.perSeed[index]) break;
      level += 1;
    }
    const reported = owner.get(label)?.level;
    if (reported !== level)
      throw new Error(`seed ${label}: the report says level ${reported}, its items ${level}`);
    return { seed: label, level };
  });
  const passing = items.filter((entry) => entry.pass).length;
  const hidden = reports.find((report) => report.hiddenSeed)?.hiddenSeed;
  return {
    seeds: labels,
    size: items.length,
    passing,
    score: passing / items.length,
    failingCauses: new Set(items.flatMap((entry) => (entry.pass ? [] : entry.causes))).size,
    shape: bankShape(bank.items as BankItem[]),
    levels,
    perSeedLevels,
    ...(hidden ? { hiddenSeed: hidden } : {}),
    items,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, ...paths] = process.argv.slice(2);
  if (!out || paths.length === 0) throw new Error('usage: sweep-summary.ts <out.json> <report.json>...');
  const summary = summariseSweep(paths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as SweepReport));
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `bank ${summary.size} items, ${summary.passing} pass on every seed, over ${summary.seeds.join(', ')}; levels ${summary.perSeedLevels.map((entry) => `${entry.seed}=${entry.level}`).join(' ')}\n`,
  );
}
