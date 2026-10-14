import {
  computeCoverage,
  type DeviationClass,
  type InvalidSpec,
  type Inventory,
  type LoadedSpec,
  type LoadResult,
  error as specError,
} from '@agent-nexus/driftbench-core';
import { effectiveSampleSize } from './estimators';
import {
  assertGridSize,
  type CompiledSpace,
  combinations,
  compileSpace,
  type Projection,
  projectGrid,
  resolveT,
  tupleValues,
} from './grid';
import { type PlacementEvent, placeSpec, type SpecPlacement } from './place';
import type { DimensionKind, SpaceMap } from './schema';

/** One allowed cell at the strength of the report, and the specs that cover it. */
export type CellCoverage = { values: Record<string, string>; count: number; specs: string[] };

export type ValueTotals = {
  id: string;
  title: string;
  /** The prior share of the value over the allowed cells (after constraints); 0 when the prior is empty. */
  share: number;
  required: boolean;
  /** False when the constraints forbid every cell holding the value. */
  allowed: boolean;
  /** How many specs place on the value. */
  specs: number;
};

export type DimensionTotals = {
  id: string;
  title: string;
  kind: DimensionKind;
  values: ValueTotals[];
  /** Values some allowed cell holds, and how many of them a spec covers. */
  allowed: number;
  covered: number;
};

/** Coverage at strength t: over every subset of t dimensions, the allowed t-tuples and the covered ones. */
export type TwiseCoverage = {
  t: number;
  /** The number of subsets of t dimensions. */
  projections: number;
  /** The t-tuples before constraints. */
  total: number;
  /** The t-tuples at least one allowed cell holds: the denominator. */
  allowed: number;
  /** The allowed t-tuples at least one spec covers. */
  covered: number;
  /** covered / allowed. */
  share: number;
};

export type GridCoverage = TwiseCoverage & {
  /** True when t is the number of dimensions: the cells are the full grid. */
  full: boolean;
  /** The prior mass of the covered cells (averaged over the subsets when t is below the number of dimensions). */
  weighted: number | null;
  /** The effective number of specs behind the weighted share; see `coverage`. */
  effectiveSampleSize: number | null;
  cells: CellCoverage[];
};

/** A cell that must be covered: from the map's required values, or a flow deviation the inventory requires. */
export type RequiredCell =
  | { source: 'map'; values: Record<string, string>; covered: boolean; specs: string[] }
  | { source: 'inventory'; flow: string; deviation: DeviationClass; covered: boolean; specs: string[] };

export const SpaceWarningCodes = ['UNKNOWN_VALUE', 'UNPLACED_SPEC', 'FORBIDDEN_CELL', 'PRIOR_EMPTY'] as const;
export type SpaceWarningCode = (typeof SpaceWarningCodes)[number];

/** Advice that never changes the verdict. `subject` is the value, spec id or prior concerned. */
export type SpaceWarning = { code: SpaceWarningCode; subject: string; specs: string[]; message: string };

/** How one valid spec falls in the grid at the strength of the report. */
export type SpecCoverage = {
  id: string;
  path: string;
  /** The allowed cells the spec covers. */
  cells: number;
  /** The share of the prior the spec stands for; null when the prior is empty. */
  weight: number | null;
};

export type SpaceCoverage = {
  agent: string;
  version: string;
  prior: { kind: 'declared' | 'fitted'; source?: string; uniform: boolean };
  constraints: number;
  dimensions: DimensionTotals[];
  grid: GridCoverage;
  /** t-wise coverage for t = 2 and t = 3, when the map has that many dimensions. */
  tway: TwiseCoverage[];
  required: RequiredCell[];
  specs: SpecCoverage[];
  warnings: SpaceWarning[];
  invalidSpecs: InvalidSpec[];
  /** False when a required cell is covered by no spec. */
  ok: boolean;
};

export type SpaceCoverageOptions = {
  /** The strength of the grid: cells on every subset of t dimensions. Defaults to the full grid. */
  t?: number;
  /** The behaviour inventory: each flow deviation it requires becomes a required cell. */
  inventory?: Inventory;
  /** The largest full grid to enumerate. */
  maxCells?: number;
};

/**
 * Coverage of a map by specs. A spec covers a cell when one of its events places on every value of the
 * cell (see `placeSpec`). Pure: reads nothing. Throws a RangeError when t is out of range or the full grid
 * is over the limit; invalid specs are listed and never count.
 *
 * - Raw share: covered allowed cells over allowed cells; forbidden cells are in neither count (t-wise
 *   coverage over a constrained grid, NIST SP 800-142, S38).
 * - Weighted share: the prior mass of the covered cells. The prior of a cell is the product of the shares
 *   of its values, restricted to the allowed cells and renormalised; below the full grid, the mass of a
 *   t-tuple is the sum over the allowed cells holding it, and the share is averaged over the subsets.
 * - Effective sample size: each covered cell's mass is split evenly among the specs covering it, a spec's
 *   weight is the sum of its parts, and n_e = (sum of w)^2 / (sum of w^2) (Owen, S43, equation 9.13). It
 *   is the number of specs when every spec stands for the same share of the user mix, and near 1 when
 *   one spec stands for most of it. Splitting a cell's mass by the suite's own allocation is the
 *   importance weight p / q with q the suite's share of each cell (S33, S43); summing it per spec is
 *   derived here.
 */
export function coverage(
  map: SpaceMap,
  specs: readonly LoadResult[],
  options: SpaceCoverageOptions = {},
): SpaceCoverage {
  const space = compileSpace(map);
  const k = space.dimensions.length;
  const t = resolveT(space, options.t);
  assertGridSize(map, options.maxCells);

  const loaded = specs.filter((result): result is LoadedSpec => result.ok);
  const placements = loaded.map((result) => placeSpec(space, result.spec));
  const ids = placements.map((placement) => placement.id);
  const required = requiredDimensions(space);

  const subsets = new Map<string, number[]>();
  for (const strength of new Set([1, 2, 3, t])) {
    for (const subset of combinations(k, strength)) subsets.set(subset.join(','), subset);
  }
  if (required.length > 0) subsets.set(required.join(','), required);
  const grid = projectGrid(space, [...subsets.values()]);
  const covered = new Map<string, Covered>();
  [...subsets.keys()].forEach((key, position) => {
    const projection = grid.projections[position];
    if (projection) covered.set(key, cover(projection, placements));
  });
  const level = (strength: number): Covered[] =>
    combinations(k, strength).flatMap((subset) => {
      const found = covered.get(subset.join(','));
      return found ? [found] : [];
    });

  const hasMass = grid.totalWeight > 0;
  const atT = level(t);
  const shares = priorShares(atT, placements.length);
  const gridCells: CellCoverage[] = [];
  for (const { projection, byCode } of atT) {
    projection.allowed.forEach((allowed, code) => {
      if (!allowed) return;
      const holders = byCode.get(code) ?? [];
      gridCells.push({
        values: tupleValues(projection, code, space),
        count: holders.length,
        specs: pick(ids, holders),
      });
    });
  }

  const dimensions = space.dimensions.map((dimension, index): DimensionTotals => {
    const single = covered.get(String(index));
    const values = dimension.values.map(
      (value, position): ValueTotals => ({
        id: value.id,
        title: value.title,
        share: hasMass ? (single?.projection.mass[position] ?? 0) : 0,
        required: value.required === true,
        allowed: single?.projection.allowed[position] === 1,
        specs: single?.byCode.get(position)?.length ?? 0,
      }),
    );
    const allowed = values.filter((value) => value.allowed);
    return {
      id: dimension.id,
      title: dimension.title,
      kind: dimension.kind,
      values,
      allowed: allowed.length,
      covered: allowed.filter((value) => value.specs > 0).length,
    };
  });

  const requiredCells: RequiredCell[] = [];
  const requiredCovered = covered.get(required.join(','));
  if (required.length > 0 && requiredCovered) {
    for (const code of requiredCodes(space, requiredCovered.projection, required)) {
      const holders = requiredCovered.byCode.get(code) ?? [];
      requiredCells.push({
        source: 'map',
        values: tupleValues(requiredCovered.projection, code, space),
        covered: holders.length > 0,
        specs: pick(ids, holders),
      });
    }
  }
  if (options.inventory) {
    for (const flow of computeCoverage(specs, options.inventory).flows) {
      for (const cell of flow.cells) {
        requiredCells.push({
          source: 'inventory',
          flow: flow.id,
          deviation: cell.deviation,
          covered: cell.status === 'covered',
          specs: cell.specs,
        });
      }
    }
  }

  const specTotals = loaded.map(
    (result, position): SpecCoverage => ({
      id: result.spec.id,
      path: result.path,
      cells: atT.reduce(
        (sum, { projection, bySpec }) =>
          sum + [...(bySpec[position] ?? [])].filter((code) => projection.allowed[code] === 1).length,
        0,
      ),
      weight: hasMass ? (shares.weights[position] ?? 0) : null,
    }),
  );

  const twise = (strength: number): TwiseCoverage => tally(level(strength), strength);
  const atTally = tally(atT, t);
  return {
    agent: map.agent,
    version: map.version,
    prior: {
      kind: map.prior.kind,
      ...(map.prior.source === undefined ? {} : { source: map.prior.source }),
      uniform: space.uniform,
    },
    constraints: map.constraints.length,
    dimensions,
    grid: {
      ...atTally,
      full: t === k,
      weighted: hasMass ? shares.weighted : null,
      effectiveSampleSize: hasMass ? effectiveSampleSize(shares.weights) : null,
      cells: gridCells,
    },
    tway: [2, 3].filter((strength) => strength <= k).map(twise),
    required: requiredCells,
    specs: specTotals,
    warnings: warningsFor(space, placements, atT, specTotals, t, hasMass),
    invalidSpecs: specs.flatMap((result): InvalidSpec[] =>
      result.ok
        ? []
        : [
            {
              path: result.path,
              error: result.errors[0] ?? specError('SPEC_PARSE', '', 'the spec is invalid'),
            },
          ],
    ),
    ok: requiredCells.every((cell) => cell.covered),
  };
}

/** A projection, which specs cover each of its tuples, and which tuples each spec covers. */
export type Covered = {
  projection: Projection;
  /** Spec positions covering each tuple code, in spec order. Forbidden tuples are included. */
  byCode: Map<number, number[]>;
  /** The tuple codes each spec covers, forbidden ones included, by spec position. */
  bySpec: Array<Set<number>>;
};

/** Which tuples of a projection each spec covers: the union over its events. */
export function cover(projection: Projection, placements: readonly SpecPlacement[]): Covered {
  const byCode = new Map<number, number[]>();
  const bySpec = placements.map((placement, position) => {
    const codes = new Set<number>();
    for (const event of placement.events) addEventCodes(projection, event, codes);
    for (const code of codes) {
      const holders = byCode.get(code) ?? [];
      holders.push(position);
      byCode.set(code, holders);
    }
    return codes;
  });
  return { projection, byCode, bySpec };
}

/** Adds the codes of every tuple an event places on: the product of its values on the projection's dimensions. */
export function addEventCodes(projection: Projection, event: PlacementEvent, out: Set<number>): void {
  addCodes(projection, event, out, 0, 0);
}

/** Walk the product in the same order, without allocating intermediate arrays for each dimension. */
function addCodes(
  projection: Projection,
  event: PlacementEvent,
  out: Set<number>,
  position: number,
  code: number,
): void {
  for (; position < projection.dimensions.length; position += 1) {
    const values = event.values[projection.dimensions[position] ?? -1] ?? [];
    if (values.length === 0) return;
    const stride = projection.stride[position] ?? 0;
    if (values.length === 1) {
      code += (values[0] as number) * stride;
      continue;
    }
    for (const value of values) addCodes(projection, event, out, position + 1, code + value * stride);
    return;
  }
  out.add(code);
}

function tally(level: readonly Covered[], t: number): TwiseCoverage {
  let total = 0;
  let allowed = 0;
  let covered = 0;
  for (const { projection, byCode } of level) {
    total += projection.size;
    for (const flag of projection.allowed) allowed += flag;
    for (const code of byCode.keys()) if (projection.allowed[code] === 1) covered += 1;
  }
  return {
    t,
    projections: level.length,
    total,
    allowed,
    covered,
    share: allowed > 0 ? covered / allowed : 0,
  };
}

/** The weighted share at one strength, and the weight each spec stands for. */
function priorShares(level: readonly Covered[], count: number): { weighted: number; weights: number[] } {
  let weighted = 0;
  const weights = Array.from({ length: count }, () => 0);
  for (const { projection, byCode } of level) {
    for (const [code, holders] of byCode) {
      if (projection.allowed[code] !== 1) continue;
      const mass = projection.mass[code] ?? 0;
      weighted += mass;
      for (const position of holders) weights[position] = (weights[position] ?? 0) + mass / holders.length;
    }
  }
  const subsets = Math.max(level.length, 1);
  return { weighted: weighted / subsets, weights: weights.map((weight) => weight / subsets) };
}

/** The dimensions that hold at least one required value, in map order. */
function requiredDimensions(space: CompiledSpace): number[] {
  return space.dimensions.flatMap((dimension, index) =>
    dimension.values.some((value) => value.required === true) ? [index] : [],
  );
}

/** The allowed tuples made only of required values, on the required dimensions, in value order. */
function requiredCodes(space: CompiledSpace, projection: Projection, required: readonly number[]): number[] {
  let codes = [0];
  required.forEach((dimension, position) => {
    const values = (space.dimensions[dimension]?.values ?? []).flatMap((value, index) =>
      value.required === true ? [index] : [],
    );
    const stride = projection.stride[position] ?? 0;
    codes = codes.flatMap((code) => values.map((value) => code + value * stride));
  });
  return codes.filter((code) => projection.allowed[code] === 1);
}

function warningsFor(
  space: CompiledSpace,
  placements: readonly SpecPlacement[],
  level: readonly Covered[],
  totals: readonly SpecCoverage[],
  t: number,
  hasMass: boolean,
): SpaceWarning[] {
  const warnings: SpaceWarning[] = [];

  const unknown = new Map<string, { kind: DimensionKind; value: string; specs: string[] }>();
  for (const placement of placements) {
    for (const entry of placement.unknown) {
      const key = `${entry.kind}\u0000${entry.value}`;
      const found = unknown.get(key) ?? { kind: entry.kind, value: entry.value, specs: [] };
      if (!found.specs.includes(placement.id)) found.specs.push(placement.id);
      unknown.set(key, found);
    }
  }
  for (const { kind, value, specs } of unknown.values()) {
    warnings.push({
      code: 'UNKNOWN_VALUE',
      subject: value,
      specs,
      message: `${kind} ${value} is named by ${specs.join(', ')}, but no ${kind} dimension of the map lists it`,
    });
  }

  placements.forEach((placement, position) => {
    if ((totals[position]?.cells ?? 0) > 0) return;
    const silent = space.dimensions.filter((_, index) =>
      placement.events.every((event) => (event.values[index] ?? []).length === 0),
    );
    const why =
      silent.length > 0
        ? `it places on no value of ${silent.map((dimension) => dimension.id).join(', ')}`
        : 'every cell it reaches is forbidden';
    warnings.push({
      code: 'UNPLACED_SPEC',
      subject: placement.id,
      specs: [placement.id],
      message: `falls in no allowed cell ${t === space.dimensions.length ? 'of the full grid' : `at t = ${t}`}: ${why}`,
    });
  });

  placements.forEach((placement, position) => {
    const forbidden: Array<{ projection: Projection; code: number }> = [];
    for (const { projection, bySpec } of level) {
      for (const code of bySpec[position] ?? []) {
        if (projection.allowed[code] !== 1) forbidden.push({ projection, code });
      }
    }
    const first = forbidden[0];
    if (!first) return;
    const values = Object.entries(tupleValues(first.projection, first.code, space))
      .map(([dimension, value]) => `${dimension}=${value}`)
      .join(' · ');
    warnings.push({
      code: 'FORBIDDEN_CELL',
      subject: placement.id,
      specs: [placement.id],
      message: `reaches ${forbidden.length} cell${forbidden.length === 1 ? '' : 's'} the constraints forbid, not counted (first: ${values}); check the spec or the constraint`,
    });
  });

  if (!hasMass) {
    warnings.push({
      code: 'PRIOR_EMPTY',
      subject: 'prior',
      specs: [],
      message: 'the prior gives no weight to any allowed cell, so no weighted share is computed',
    });
  }
  return warnings;
}

function pick(ids: readonly string[], positions: readonly number[]): string[] {
  return positions.flatMap((position) => {
    const id = ids[position];
    return id === undefined ? [] : [id];
  });
}
