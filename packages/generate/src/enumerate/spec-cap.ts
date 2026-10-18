import type { Spec } from '@agent-nexus/driftbench-core';
import {
  type CompiledSpace,
  cover,
  type Projection,
  placeSpec,
  tupleValues,
} from '@agent-nexus/driftbench-space';
import type { Seeder } from '../seed/assemble';
import { type CoverElement, selectGolden } from '../select/cover';

export type CapCoverage = {
  t: number;
  allowed: number;
  candidate: number;
  selected: number;
  /** Every allowed tuple not reached by the written complete specs, including pre-existing gaps. */
  uncovered: Record<string, string>[];
  /** Tuples reached by the uncapped candidate pool but lost to this cap. */
  lost: Record<string, string>[];
};

export type SpecCapMode = 'tuples' | 'pairs';

export type SpecCapReport = {
  mode: SpecCapMode;
  limit: number;
  candidates: number;
  written: number;
  protected: number;
  /** Size of the deterministic greedy cover, not a proof of the global minimum. */
  preserving: number;
  preserved: boolean;
  trimmed: Partial<Record<Seeder, number>>;
  coverage: CapCoverage[];
};

export type CapGrid = { space: CompiledSpace; projections: Projection[] };

/**
 * A total file cap, independent of the budget seeder's row budget. Keep every structural, boundary,
 * deviation, metamorphic and task probe, and every incomplete spec. Only redundant complete twise and
 * cover specs are eligible for removal. Select against actual block placements at both t = 2 and t = 3
 * (and the requested strength when higher); a smaller cap lists every tuple it loses.
 */
export function capSpecPool(
  all: readonly Spec[],
  complete: readonly Spec[],
  limit: number,
  grids: readonly CapGrid[],
  mode: SpecCapMode = 'tuples',
): { ids: Set<string>; report: SpecCapReport } {
  if (mode !== 'tuples' && mode !== 'pairs') throw new RangeError('specCapMode must be tuples or pairs');
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError('specCap must be a whole number of at least 1');
  const completeIds = new Set(complete.map((spec) => spec.id));
  const protectedIds = new Set(
    all
      .filter((spec) => !completeIds.has(spec.id) || !['twise', 'cover'].includes(seederOf(spec)))
      .map((spec) => spec.id),
  );
  if (protectedIds.size > limit)
    throw new RangeError(
      `--spec-cap ${limit} is below the ${protectedIds.size} protected structural, fault and incomplete specs; none can be trimmed`,
    );

  const cells: CoverElement[] = [];
  const rows = grids.map(({ space, projections }) => {
    const placements = complete.map((spec) => placeSpec(space, spec));
    const tuples: Array<{ values: Record<string, string>; holders: string[] }> = [];
    for (const projection of projections) {
      const covered = cover(projection, placements);
      projection.allowed.forEach((allowed, code) => {
        if (!allowed) return;
        const values = tupleValues(projection, code, space);
        const holders = (covered.byCode.get(code) ?? []).map((index) => complete[index]?.id as string);
        tuples.push({ values, holders });
        if (holders.length === 0 || holders.some((id) => protectedIds.has(id))) return;
        const key = JSON.stringify(values);
        if (mode === 'tuples' || projection.dimensions.length <= 2)
          cells.push({ key, label: key, specs: holders });
      });
    }
    return { t: projections[0]?.dimensions.length ?? 0, tuples };
  });
  const selection = selectGolden({
    pool: complete.filter((spec) => !protectedIds.has(spec.id)).map((spec) => spec.id),
    cells,
    required: [],
    k: limit - protectedIds.size,
  });
  const ids = new Set([...protectedIds, ...selection.golden.map((pick) => pick.id)]);
  const trimmed: Partial<Record<Seeder, number>> = {};
  for (const spec of all) {
    if (ids.has(spec.id)) continue;
    const seeder = seederOf(spec);
    trimmed[seeder] = (trimmed[seeder] ?? 0) + 1;
  }
  const coverage = rows.map(({ t, tuples }): CapCoverage => {
    const uncovered = tuples.filter((tuple) => !tuple.holders.some((id) => ids.has(id)));
    return {
      t,
      allowed: tuples.length,
      candidate: tuples.filter((tuple) => tuple.holders.length > 0).length,
      selected: tuples.length - uncovered.length,
      uncovered: uncovered.map((tuple) => tuple.values),
      lost: uncovered.filter((tuple) => tuple.holders.length > 0).map((tuple) => tuple.values),
    };
  });
  return {
    ids,
    report: {
      mode,
      limit,
      candidates: all.length,
      written: ids.size,
      protected: protectedIds.size,
      preserving: protectedIds.size + selection.cover.length,
      preserved: coverage.every((entry) => (mode === 'pairs' && entry.t > 2) || entry.lost.length === 0),
      trimmed,
      coverage,
    },
  };
}

export function seederOf(spec: Spec): Seeder {
  return (spec.metadata?.generated as { seeder?: Seeder } | undefined)?.seeder ?? 'task';
}
