/**
 * The ladder contract. A validator is a ladder of levels; each level measures one metric against one
 * threshold and names the items behind a failure. Levels run in order and the run stops at the first
 * failing level, so a builder never chases two causes at once. Design: docs/validators.md section 1.
 */

/** One named item behind a count: what failed, the one component it points at, and what to look at. */
export type Item = {
  id: string;
  component: string;
  detail: string;
};

/** What a level computes: the observed value of its metric and the items behind it. */
export type Measure = {
  value: number;
  items: Item[];
};

/** What a level computes from. `root` is the repository root, `hidden` marks the hidden seed. */
export type LadderContext = {
  seed: number;
  hidden: boolean;
  root: string;
};

/** `atLeast`: the level passes when the value is at least the threshold; `atMost`: at most. */
export type Direction = 'atLeast' | 'atMost';

export type LevelDef = {
  id: string;
  name: string;
  /** The metric in words, a ratio of two counts, such as "fixtures matched / fixtures compared". */
  metric: string;
  threshold: number;
  direction?: Direction;
  compute(ctx: LadderContext): Measure | Promise<Measure>;
};

export type Ladder = {
  component: string;
  levels: readonly LevelDef[];
};

/** Names the command keeps for itself: a ladder cannot take them. */
export const RESERVED_COMPONENTS = ['all', 'floors', 'protect', 'list'] as const;

const COMPONENT = /^[a-z][a-z0-9-]*$/;
const LEVEL_ID = /^[a-z][a-z0-9-]*$/;

/** Checks a ladder definition and returns it frozen. Throws a TypeError naming the first problem. */
export function defineLadder(def: Ladder): Ladder {
  if (!COMPONENT.test(def.component)) {
    throw new TypeError(
      `A ladder component is lower case letters, digits and hyphens, not "${def.component}".`,
    );
  }
  if ((RESERVED_COMPONENTS as readonly string[]).includes(def.component)) {
    throw new TypeError(`"${def.component}" is reserved by driftbench validate.`);
  }
  if (def.levels.length === 0) throw new TypeError(`The ladder ${def.component} has no level.`);
  const seen = new Set<string>();
  for (const level of def.levels) {
    if (!LEVEL_ID.test(level.id)) {
      throw new TypeError(`A level id is lower case letters, digits and hyphens, not "${level.id}".`);
    }
    if (seen.has(level.id))
      throw new TypeError(`The ladder ${def.component} repeats the level id ${level.id}.`);
    seen.add(level.id);
    if (!Number.isFinite(level.threshold)) {
      throw new TypeError(`The level ${level.id} of ${def.component} has no finite threshold.`);
    }
    if (level.name.trim() === '' || level.metric.trim() === '') {
      throw new TypeError(`The level ${level.id} of ${def.component} needs a name and a metric.`);
    }
  }
  return Object.freeze({
    component: def.component,
    levels: Object.freeze(def.levels.map((level) => Object.freeze({ ...level }))),
  });
}

/** One row of the ladder table. `observed`, `pass` and `itemCount` are null for a level not run. */
export type LevelRow = {
  level: number;
  id: string;
  name: string;
  metric: string;
  threshold: number;
  direction: Direction;
  observed: number | null;
  pass: boolean | null;
  itemCount: number | null;
};

/** The run of one ladder on one seed. `level` is the highest level passed, 0 when level 1 fails. */
export type SeedRun = {
  seed: number;
  hidden: boolean;
  level: number;
  top: number;
  rows: LevelRow[];
  failing: { level: number; id: string; name: string; items: Item[] } | null;
};

export type RunOptions = {
  seed: number;
  /** True when this seed is the hidden seed; it changes only the label of the run. */
  hiddenSeed?: boolean;
  root?: string;
};

/** Whether an observed value passes a threshold. NaN never passes. */
export function passes(value: number, threshold: number, direction: Direction = 'atLeast'): boolean {
  if (Number.isNaN(value)) return false;
  return direction === 'atLeast' ? value >= threshold : value <= threshold;
}

/**
 * Evaluates the levels in order and stops at the first failing level. A level that throws fails with one
 * item naming the error. Levels after the first failure are listed but not computed.
 */
export async function runLadder(ladder: Ladder, options: RunOptions): Promise<SeedRun> {
  const ctx: LadderContext = {
    seed: options.seed,
    hidden: options.hiddenSeed ?? false,
    root: options.root ?? process.cwd(),
  };
  const rows: LevelRow[] = [];
  let failing: SeedRun['failing'] = null;
  let level = 0;
  for (const [index, def] of ladder.levels.entries()) {
    const direction = def.direction ?? 'atLeast';
    const base = {
      level: index + 1,
      id: def.id,
      name: def.name,
      metric: def.metric,
      threshold: def.threshold,
      direction,
    };
    if (failing) {
      rows.push({ ...base, observed: null, pass: null, itemCount: null });
      continue;
    }
    let measure: Measure;
    try {
      measure = await def.compute(ctx);
    } catch (cause) {
      measure = {
        value: Number.NaN,
        items: [
          {
            id: `${def.id}:error`,
            component: ladder.component,
            detail: `the level threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ],
      };
    }
    const pass = passes(measure.value, def.threshold, direction);
    rows.push({ ...base, observed: measure.value, pass, itemCount: measure.items.length });
    if (pass) {
      level = index + 1;
    } else {
      failing = { level: index + 1, id: def.id, name: def.name, items: measure.items };
    }
  }
  return {
    seed: options.seed,
    hidden: options.hiddenSeed ?? false,
    level,
    top: ladder.levels.length,
    rows,
    failing,
  };
}

/** A seed to run: its value and whether it is the hidden seed. */
export type SeedSpec = { seed: number; hidden: boolean };

/** The run of one ladder over several seeds. `level` is the minimum over the seeds. */
export type LadderReport = {
  component: string;
  level: number;
  top: number;
  seeds: SeedRun[];
};

/** Runs a ladder on every seed in order. The level of the report is the minimum level over its seeds. */
export async function runSeeds(
  ladder: Ladder,
  seeds: readonly SeedSpec[],
  root?: string,
): Promise<LadderReport> {
  if (seeds.length === 0) throw new RangeError('runSeeds needs at least one seed.');
  const runs: SeedRun[] = [];
  for (const spec of seeds) {
    runs.push(
      await runLadder(ladder, { seed: spec.seed, hiddenSeed: spec.hidden, ...(root ? { root } : {}) }),
    );
  }
  return {
    component: ladder.component,
    level: Math.min(...runs.map((run) => run.level)),
    top: ladder.levels.length,
    seeds: runs,
  };
}

/** The label of a seed in tables and files: its number, or "hidden". */
export function seedLabel(run: { seed: number; hidden: boolean }): string {
  return run.hidden ? 'hidden' : String(run.seed);
}
