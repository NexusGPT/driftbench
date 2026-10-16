/** The t-wise and budget seeders: rows of a covering array over the conversation axes, as specs. */

import { NONE } from '@agent-nexus/driftbench-space';
import type { Pick, SpecDraft } from './assemble';
import { enumerateCells, selectBudget, slicedLhs } from './budget';
import { draftOutput } from './draft-output';
import { Feasibility } from './feasible';
import { dimensionId, type PreparedMap, valueId } from './map';
import { impossibleConstraints } from './possible';
import { range, rngFor } from './random';
import {
  carrierDraft,
  flowsOfBehaviour,
  hasPaths,
  pad,
  preferring,
  probeOf,
  type SeedContext,
  scenarioDraft,
  withReasons,
} from './seed-drafts';
import { type AllowedCheck, coveringArray, visitCoveringArray } from './twise';

// The t-wise covering array ----------------------------------------------------------------------------

export type TwiseSummary = {
  t: number;
  dimensions: string[];
  rows: number;
  allowed: number;
  covered: number;
  share: number;
  /** Pairs of the array's dimensions no path of the map reaches, so the target leaves them out. */
  unreachable: string[];
};

/**
 * The dimensions the covering array spans: the axes, but the stage graph's (stage, transitions). Details
 * are chosen inside each row's cell, never crossed.
 */
export function twiseDimensions(prepared: PreparedMap): number[] {
  // A task setting (a task axis) belongs to a code-agent task, never to a conversation: its values come
  // from the task families, not from the covering array.
  return [...prepared.axes]
    .sort((a, b) => a - b)
    .filter((index) => index !== prepared.stage && index !== prepared.transition)
    .filter((index) => prepared.space.dimensions[index]?.kind !== 'task');
}

/**
 * The feasibility the t-wise target is counted with: the written constraints plus the pairs no path of the
 * map can reach, so the report counts only the tuples a possible cell holds.
 */
export function reachableFeasibility(prepared: PreparedMap): Feasibility {
  const extra = unreachablePairs(prepared);
  if (extra.length === 0) return prepared.feasibility;
  return new Feasibility({ ...prepared.space, constraints: [...prepared.space.constraints, ...extra] });
}

const unreachableMemo = new WeakMap<PreparedMap, ReturnType<typeof impossibleConstraints>>();

function unreachablePairs(prepared: PreparedMap): ReturnType<typeof impossibleConstraints> {
  let known = unreachableMemo.get(prepared);
  if (!known) {
    known = impossibleConstraints(prepared, flowsOfBehaviour);
    unreachableMemo.set(prepared, known);
  }
  return known;
}

/**
 * The conversation drafts of a set of rows: one cell per row, its path (when the map holds approved
 * paths), or a carrier when no path builds. `label` names the rows in their titles.
 */
export function rowDrafts(
  prepared: PreparedMap,
  context: SeedContext,
  cells: readonly (readonly Pick[])[],
  label: string,
): SpecDraft[] {
  const output = draftOutput(context);
  cells.forEach((cell, index) => {
    output.push(rowDraft(prepared, context, cell, index, cells.length, label));
  });
  return output.drafts;
}

function rowDraft(
  prepared: PreparedMap,
  context: SeedContext,
  cell: readonly Pick[],
  index: number,
  total: number,
  label: string,
): SpecDraft {
  const id = `gen-twise-${pad(index + 1)}`;
  const title = `${label} row ${index + 1} of ${total}`;
  if (!hasPaths(prepared)) return carrierDraft(prepared, context, id, 'twise', title, [...cell]);
  const behaviour = cell
    .filter(
      ([dimension]) =>
        prepared.axes.has(dimension) && prepared.space.dimensions[dimension]?.kind === 'behaviour',
    )
    .map(([dimension, value]) => valueId(prepared, dimension, value))[0];
  const flows = behaviour === undefined ? [] : flowsOfBehaviour(prepared, behaviour);
  const paths = prepared.relations.paths.filter((path) => flows.includes(path.flow));
  const probe = probeOf(prepared, cell);
  const fixed = cell.filter(([dimension]) => dimension !== prepared.deviation);
  // The behaviour's own paths first; when none of them builds (no path, or its flows give no recovery
  // from the row's deviation), a path of another flow keeps the row's cell complete.
  const own = preferring(paths, behaviour);
  const elsewhere = prepared.relations.paths.filter((path) => !flows.includes(path.flow));
  const built = scenarioDraft(
    prepared,
    context,
    id,
    'twise',
    title,
    fixed,
    { preferred: own.preferred, others: [...own.others, ...elsewhere] },
    { ...(probe ? { probe } : {}) },
  );
  if ('draft' in built) {
    const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
    if (deviation) built.draft.cell.push(deviation);
    return built.draft;
  }
  const reasons =
    paths.length === 0
      ? [`no approved path belongs to a flow of ${behaviour ?? 'the row'} (${flows.join(', ') || 'none'})`]
      : built.reasons;
  return withReasons(carrierDraft(prepared, context, id, 'twise', title, [...cell]), reasons);
}

/** The conversation's cell of each row: the twise dimensions, the task axes held at their `none`. */
function conversationOf(prepared: PreparedMap): {
  dimensions: number[];
  sizes: number[];
  allowed: AllowedCheck;
} {
  const dimensions = twiseDimensions(prepared);
  const sizes = prepared.space.dimensions.map((dimension) => dimension.values.length);
  // A row is a conversation: it holds no task setting, so every task axis stays at its `none`.
  const taskNones: Pick[] = [...prepared.axes].flatMap((index): Pick[] => {
    const dimension = prepared.space.dimensions[index];
    const empty = dimension?.index.get(NONE);
    return dimension?.kind === 'task' && empty !== undefined ? [[index, empty]] : [];
  });
  const reachable = reachableFeasibility(prepared);
  return {
    dimensions,
    sizes,
    allowed: { allowed: (picks: readonly Pick[]) => reachable.allowed([...picks, ...taskNones]) },
  };
}

export function twiseSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: TwiseSummary } {
  const { dimensions, sizes, allowed } = conversationOf(prepared);
  const t = Math.min(context.t, dimensions.length);
  const spool = context.rows;
  const array = spool
    ? visitCoveringArray(allowed, sizes, dimensions, t, rngFor(context.seed, 'twise'), context.max, (row) =>
        spool.push(row),
      )
    : coveringArray(allowed, sizes, dimensions, t, rngFor(context.seed, 'twise'), context.max);
  const count = typeof array.rows === 'number' ? array.rows : array.rows.length;
  const output = draftOutput(context);
  let index = 0;
  for (const row of spool ?? (array.rows as number[][])) {
    const cell = dimensions.map((dimension): Pick => [dimension, row[dimension] ?? 0]);
    output.push(rowDraft(prepared, context, cell, index, count, 't-wise'));
    index += 1;
  }
  const drafts = output.drafts;
  const summary: TwiseSummary = {
    t,
    dimensions: dimensions.map((dimension) => dimensionId(prepared, dimension)),
    rows: count,
    allowed: array.allowed,
    covered: array.covered,
    share: array.allowed === 0 ? 0 : array.covered / array.allowed,
    unreachable: unreachablePairs(prepared)
      .filter((pair) => pair.every(([dimension]) => dimensions.includes(dimension)))
      .map((pair) =>
        pair
          .map(
            ([dimension, value]) =>
              `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
          )
          .join(' & '),
      ),
  };
  return { drafts, summary };
}

/** The budget seeder's account of its picks: pair coverage and the value balance per dimension. */
export type BudgetSummary = {
  budget: number;
  seed: number;
  dimensions: string[];
  /** Allowed cells of the pool. */
  pool: number;
  /** Rows picked: the budget, or the pool limit when numeric settings are absent. */
  picked: number;
  /** Selection stopped at the distinct-cell pool limit; always false with numeric settings. */
  capped: boolean;
  pairs: { allowed: number; covered: number; share: number };
  values: Array<{
    dimension: string;
    allowed: number;
    values: Array<{ value: string; count: number; fair: number; deviation: number }>;
  }>;
  /** The largest |count - fair share| over every value of every dimension. */
  maxDeviation: number;
  /** Numeric quantiles are Latin globally and within each categorical cell. Integer values may repeat. */
  numeric?: {
    settings: Array<{ id: string; min: number; max: number; integer: boolean; unit?: string }>;
    rows: Array<{
      spec: string;
      cell: Record<string, string>;
      quantiles: Record<string, number>;
      vars: Record<string, number>;
    }>;
  };
};

/**
 * Budget mode: N conversations placed by the budget rules (seed/budget.ts) over the twise dimensions. Pair
 * coverage is the hard rule, the Latin hypercube balance breaks ties. Each picked cell is drafted as a
 * twise row is, so the rest of the pipeline is the same.
 */
export function budgetSeeder(
  prepared: PreparedMap,
  context: SeedContext,
  options: { budget: number },
): { drafts: SpecDraft[]; summary: TwiseSummary; budget: BudgetSummary } {
  const { dimensions, sizes, allowed } = conversationOf(prepared);
  const settings = prepared.numericSettings ?? [];
  const reuse = settings.length > 0;
  const pool =
    reuse && dimensions.length === 0 && allowed.allowed([])
      ? [[]]
      : enumerateCells(
          sizes.filter((_, index) => dimensions.includes(index)),
          (cell) =>
            allowed.allowed(cell.map((value, index) => [dimensions[index] as number, value] as const)),
        );
  const selection = selectBudget(
    pool,
    dimensions.map((dimension) => sizes[dimension] ?? 0),
    options.budget,
    rngFor(context.seed, 'budget'),
    reuse,
  );
  const cells = selection.picked.map((index) =>
    dimensions.map((dimension, column): Pick => [dimension, pool[index]?.[column] ?? 0]),
  );
  const drafts = rowDrafts(prepared, context, cells, 'budget');
  const picked = selection.picked.length;
  let numeric: BudgetSummary['numeric'];
  if (reuse) {
    if (picked === 0) throw new RangeError('numeric budget has no allowed categorical cell');
    const slices = selection.picked.map((index) => JSON.stringify(pool[index]));
    const rows = drafts.map((draft, index) => ({
      spec: draft.id,
      cell: Object.fromEntries(
        (cells[index] ?? []).map(([dimension, value]) => [
          dimensionId(prepared, dimension),
          valueId(prepared, dimension, value),
        ]),
      ),
      quantiles: {} as Record<string, number>,
      vars: {} as Record<string, number>,
    }));
    for (const setting of settings) {
      const quantiles = slicedLhs(rngFor(context.seed, `budget:numeric:${setting.id}`), 0, 1, picked, slices);
      quantiles.forEach((quantile, index) => {
        const row = rows[index];
        if (!row) return;
        row.quantiles[setting.id] = quantile;
        row.vars[setting.id] = setting.integer
          ? Math.ceil(setting.min) +
            Math.floor(quantile * (Math.floor(setting.max) - Math.ceil(setting.min) + 1))
          : setting.min + quantile * (setting.max - setting.min);
      });
    }
    drafts.forEach((draft, index) => {
      draft.vars = rows[index]?.vars;
    });
    numeric = {
      settings: settings.map(({ id, min, max, integer, unit }) => ({
        id,
        min,
        max,
        integer: integer ?? false,
        ...(unit === undefined ? {} : { unit }),
      })),
      rows,
    };
  }
  const share = selection.pairs.allowed === 0 ? 0 : selection.pairs.covered / selection.pairs.allowed;
  const summary: TwiseSummary = {
    t: 2,
    dimensions: dimensions.map((dimension) => dimensionId(prepared, dimension)),
    rows: picked,
    allowed: selection.pairs.allowed,
    covered: selection.pairs.covered,
    share,
    unreachable: unreachablePairs(prepared)
      .filter((pair) => pair.every(([dimension]) => dimensions.includes(dimension)))
      .map((pair) =>
        pair
          .map(
            ([dimension, value]) =>
              `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
          )
          .join(' & '),
      ),
  };
  const values = dimensions.map((dimension, column) => {
    const allowedCount = selection.allowedValues[column] ?? 0;
    const fair = allowedCount === 0 ? 0 : picked / allowedCount;
    const present = (value: number) => (pool.some((row) => row[column] === value) ? value : -1);
    const rows = range(sizes[dimension] ?? 0)
      .map(present)
      .filter((value) => value >= 0)
      .map((value) => {
        const count = selection.counts[column]?.[value] ?? 0;
        return {
          value: valueId(prepared, dimension, value),
          count,
          fair,
          deviation: count - fair,
        };
      });
    return { dimension: dimensionId(prepared, dimension), allowed: allowedCount, values: rows };
  });
  const maxDeviation = Math.max(
    0,
    ...values.flatMap((entry) => entry.values.map((value) => Math.abs(value.deviation))),
  );
  const budget: BudgetSummary = {
    budget: options.budget,
    seed: context.seed,
    dimensions: summary.dimensions,
    pool: pool.length,
    picked,
    capped: !reuse && options.budget > pool.length,
    pairs: { ...selection.pairs, share },
    values,
    maxDeviation,
    ...(numeric === undefined ? {} : { numeric }),
  };
  return { drafts, summary, budget };
}
