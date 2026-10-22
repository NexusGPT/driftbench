import type { LadderReport, LevelRow } from '@agent-nexus/driftbench-validators';

/** What the section of a report that holds the levels measured beyond the first failing level says about them. */
export const BEYOND_NOTE =
  'Measured beyond the first failing level: these levels never count toward the level reached, and none of them is a pass.';

/** A level measured above its seed's first failing level: its measure, with `metThreshold` in place of a verdict. */
export type BeyondLevel = Omit<LevelRow, 'pass' | 'beyond'> & { metThreshold: boolean | null };

export type BeyondSeed = { seed: number; hidden: boolean; firstFailingLevel: number; levels: BeyondLevel[] };

export type BeyondSection = { note: string; seeds: BeyondSeed[] };

/**
 * A full run (`--all-levels`) split for its report: every row above its seed's first failing level is shown as not
 * run in the table, and its measure moves to a section of its own, so no reader takes it for a pass. The level, the
 * first failing level and its items are unchanged. A stopping run has nothing beyond and is returned as it is.
 */
export function splitBeyond(report: LadderReport): { report: LadderReport; beyond: BeyondSection } {
  const seeds: BeyondSeed[] = [];
  const shown = report.seeds.map((run) => {
    const moved = run.rows.filter((row) => row.beyond);
    if (moved.length === 0 || !run.failing) return run;
    seeds.push({
      seed: run.seed,
      hidden: run.hidden,
      firstFailingLevel: run.failing.level,
      levels: moved.map(({ pass, beyond: _beyond, ...measure }) => ({ ...measure, metThreshold: pass })),
    });
    return { ...run, rows: run.rows.map((row) => (row.beyond ? notRun(row) : row)) };
  });
  return { report: { ...report, seeds: shown }, beyond: { note: BEYOND_NOTE, seeds } };
}

function notRun(row: LevelRow): LevelRow {
  const { bank: _bank, items: _items, beyond: _beyond, ...bare } = row;
  return { ...bare, observed: null, pass: null, itemCount: null };
}

/**
 * The inverse of `splitBeyond`, for `--reports`: a leg that holds `beyondTheFirstFailingLevel` gets each level of
 * that section back in its row, as the unsplit run wrote it (its measure, `pass` from `metThreshold`, `beyond`, its
 * bank, items and any measurement error), so the join reads exactly what the run measured: a measurement error at
 * any level still stops it, and a full join finds every level. A section that does not fit its rows is refused with
 * a message.
 */
export function unsplitBeyond(
  leg: LadderReport & { beyondTheFirstFailingLevel?: unknown },
): LadderReport | string {
  const { beyondTheFirstFailingLevel: section, ...report } = leg;
  if (section === undefined) return report;
  const seeds = (section as Partial<BeyondSection> | null)?.seeds;
  if (!Array.isArray(seeds)) return 'its beyondTheFirstFailingLevel section holds no seeds';
  const runs = report.seeds.map((run) => ({ ...run, rows: [...run.rows] }));
  for (const entry of seeds as BeyondSeed[]) {
    const run = runs.find(
      (candidate) => candidate.seed === entry?.seed && candidate.hidden === entry?.hidden,
    );
    if (!run || !Array.isArray(entry.levels)) return 'its beyond section names a seed it does not hold';
    for (const level of entry.levels) {
      const index = level?.level - 1;
      const row = run.rows[index];
      if (!row || row.id !== level.id || row.pass !== null || !(level.level > entry.firstFailingLevel))
        return `its beyond section does not fit level ${String(level?.level)} of seed ${run.seed}`;
      const { metThreshold, ...measure } = level;
      run.rows[index] = { ...measure, pass: metThreshold, beyond: true };
    }
  }
  return { ...report, seeds: runs };
}
