import { type LadderReport, seedLabel, type Tier } from './ladder';

/** The family key of an item that names none, and the tier key of an item that names none. */
export const NO_FAMILY = 'none';
export const NO_TIER = 'none';
/** The family of a level that returns no bank: the level counts as one item. */
export const LEVEL_FAMILY = 'levels';

export type BankVerdict = 'pass' | 'fail' | 'not run';

/** One item of the bank across the seeds of a run. */
export type BankRow = {
  level: number;
  levelId: string;
  id: string;
  component: string;
  family: string;
  tier: Tier | undefined;
  /** One verdict per seed, in the order of the report's seeds. */
  perSeed: BankVerdict[];
  /** True when the item passed on every seed of the run. */
  passEverySeed: boolean;
};

/**
 * The bank of a run: every item of every level, its verdict per seed, the bank score (items passing on every
 * seed over the bank) and the counts the journal row records. A level that returns no bank counts as one item
 * of the family "levels", named by the level id.
 */
export type BankSummary = {
  seeds: string[];
  size: number;
  passing: number;
  score: number;
  /** Items per family and tier: `{ family: { "1".."5" | "none": count } }`. */
  byFamilyTier: Record<string, Record<string, number>>;
  /** Items not passing on every seed, per family; every family of the bank is listed, 0 included. */
  failingByFamily: Record<string, number>;
  rows: BankRow[];
};

/** The bank summary of a report. Run the report with `full` so the levels above a failure are known. */
export function bankSummary(report: LadderReport): BankSummary {
  const seeds = report.seeds.map(seedLabel);
  const rows = new Map<string, BankRow>();
  const levelCount = report.seeds[0]?.rows.length ?? 0;
  for (let index = 0; index < levelCount; index += 1) {
    report.seeds.forEach((run, seedIndex) => {
      const row = run.rows[index];
      if (!row) return;
      if (!row.bank && row.pass === null) {
        // Not run on this seed and no bank seen: the level stands as one item until a seed runs it.
        const key = `${row.level}/${row.id}`;
        if (!rows.has(key)) {
          rows.set(key, blank(row.level, row.id, row.id, report.component, LEVEL_FAMILY, seeds));
        }
        return;
      }
      const entries: { id: string; component: string; family?: string; tier?: Tier; pass: boolean }[] =
        row.bank ?? [
          { id: row.id, component: report.component, family: LEVEL_FAMILY, pass: row.pass === true },
        ];
      for (const entry of entries) {
        const key = `${row.level}/${entry.id}`;
        let target = rows.get(key);
        if (!target) {
          target = blank(row.level, row.id, entry.id, entry.component, entry.family ?? NO_FAMILY, seeds);
          target.tier = entry.tier;
          rows.set(key, target);
        }
        target.perSeed[seedIndex] = entry.pass ? 'pass' : 'fail';
      }
    });
  }
  const banked = new Set(
    report.seeds.flatMap((run) => run.rows.filter((row) => row.bank).map((row) => row.level)),
  );
  const list = [...rows.values()].filter(
    (row) => !(banked.has(row.level) && row.family === LEVEL_FAMILY && row.id === row.levelId),
  );
  for (const row of list) row.passEverySeed = row.perSeed.every((verdict) => verdict === 'pass');
  const byFamilyTier: Record<string, Record<string, number>> = {};
  const failingByFamily: Record<string, number> = {};
  for (const row of list) {
    const tiers = byFamilyTier[row.family] ?? {};
    byFamilyTier[row.family] = tiers;
    const tier = row.tier === undefined ? NO_TIER : String(row.tier);
    tiers[tier] = (tiers[tier] ?? 0) + 1;
    failingByFamily[row.family] = (failingByFamily[row.family] ?? 0) + (row.passEverySeed ? 0 : 1);
  }
  const passing = list.filter((row) => row.passEverySeed).length;
  return {
    seeds,
    size: list.length,
    passing,
    score: list.length === 0 ? 0 : passing / list.length,
    byFamilyTier: sortKeys(byFamilyTier),
    failingByFamily: sortKeys(failingByFamily),
    rows: list,
  };
}

function blank(
  level: number,
  levelId: string,
  id: string,
  component: string,
  family: string,
  seeds: string[],
): BankRow {
  return {
    level,
    levelId,
    id,
    component,
    family,
    tier: undefined,
    perSeed: seeds.map(() => 'not run'),
    passEverySeed: false,
  };
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The bank listing of `--items`: one block per family, items ordered by tier then level then id, each with its
 * verdict per seed; then the bank score and the counts per family and tier.
 */
export function formatItems(summary: BankSummary, component: string): string {
  const families = Object.keys(summary.byFamilyTier);
  let text = `Bank of ${component}: ${summary.size} items in ${families.length} famil${
    families.length === 1 ? 'y' : 'ies'
  }, ${summary.passing} pass on every seed (score ${round(summary.score)}).\n`;
  const header = ['Item', 'Tier', 'Level', 'Component', ...summary.seeds.map((seed) => `seed ${seed}`)];
  for (const family of families) {
    const members = summary.rows
      .filter((row) => row.family === family)
      .sort(
        (a, b) =>
          (a.tier ?? 6) - (b.tier ?? 6) ||
          a.level - b.level ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
    const failing = summary.failingByFamily[family] ?? 0;
    text += `\nFamily ${family}: ${members.length} items, ${failing} failing; per tier ${tierCounts(
      summary.byFamilyTier[family] ?? {},
    )}\n`;
    text += table(
      header,
      members.map((row) => [
        row.id,
        row.tier === undefined ? '-' : String(row.tier),
        `${row.level} ${row.levelId}`,
        row.component,
        ...row.perSeed.map((verdict) => (verdict === 'fail' ? 'FAIL' : verdict)),
      ]),
    );
  }
  return text;
}

function tierCounts(tiers: Record<string, number>): string {
  return Object.entries(tiers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, count]) => `${tier === NO_TIER ? 'none' : tier}: ${count}`)
    .join(', ');
}

function round(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (row: string[]) =>
    row
      .map((text, column) => text.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join('\n')}\n`;
}
