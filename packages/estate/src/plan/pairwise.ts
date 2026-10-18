import { coveringArray, Feasibility, rngFor } from '@agent-nexus/driftbench-generate';
import { compileSpace, type SpaceMap } from '@agent-nexus/driftbench-space';

/**
 * Pairwise cells (design section 4): t-wise combinations over the axis dimensions of the space map, under
 * its constraint list, by the generator's greedy covering array (`coveringArray`, AETG with constrained
 * t-way coverage). The full grid is never enumerated.
 *
 * Design section 3 lists the target atoms as one axis: a block exercises an atom in a situation. The space
 * map splits that axis by kind (`atoms.instruction`, `atoms.gate`, ...) so its values stay unique per kind.
 * A row that held one atom of every kind would ask one test to exercise a supplier rule, a weekly report
 * route and a force-push guard at once, which no ask can do. So the covering array runs on the situation
 * axes plus one target dimension that merges the `atoms.*` dimensions: every allowed t-tuple of situation
 * values, and of a target atom with situation values, lands in some row. A constraint that names target
 * atoms is carried over on the merged dimension; one that names atoms of two kinds can never hold for a
 * row with one target, and is dropped.
 */

export const TARGET_PREFIX = 'atoms.';
const TARGET = 'target';

export type PairwiseCell = {
  /** The target atom, and the space map dimension that lists it (`atoms.<kind>`). */
  atom: string;
  dimension: string;
  /** Situation dimension id to value id. */
  situation: Record<string, string>;
};

export type PairwiseResult = {
  t: number;
  cells: PairwiseCell[];
  /** Allowed t-tuples over the merged space, and how many the rows cover. */
  allowed: number;
  covered: number;
  /** The situation dimensions, in map order. */
  situations: string[];
  /** Constraints dropped because they name target atoms of two kinds. */
  dropped: number;
};

export type PairwiseOptions = { t: number; seed: number; maxRows: number };

export function pairwiseCells(space: SpaceMap, options: PairwiseOptions): PairwiseResult {
  const situations = space.dimensions.filter((dimension) => !dimension.id.startsWith(TARGET_PREFIX));
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith(TARGET_PREFIX));
  const dimensionOf = new Map<string, string>();
  for (const dimension of targets)
    for (const value of dimension.values) dimensionOf.set(value.id, dimension.id);
  const values = targets.flatMap((dimension) => dimension.values);
  if (values.length === 0) throw new Error('the space map names no target atom (no atoms.* dimension)');

  let dropped = 0;
  const constraints: SpaceMap['constraints'] = [];
  for (const constraint of space.constraints) {
    const forbid: Record<string, string> = {};
    let atomDimensions = 0;
    for (const [dimension, value] of Object.entries(constraint.forbid)) {
      if (dimension.startsWith(TARGET_PREFIX)) {
        atomDimensions += 1;
        forbid[TARGET] = value;
      } else forbid[dimension] = value;
    }
    if (atomDimensions > 1) dropped += 1;
    else constraints.push({ forbid, reason: constraint.reason });
  }

  const merged: SpaceMap = {
    version: space.version,
    agent: space.agent,
    dimensions: [
      ...situations,
      { id: TARGET, title: 'The atom a block exercises', kind: 'behaviour', values },
    ],
    constraints,
    prior: { kind: 'declared' },
  };
  const compiled = compileSpace(merged);
  const sizes = compiled.dimensions.map((dimension) => dimension.values.length);
  const t = Math.min(options.t, sizes.length);
  const array = coveringArray(
    new Feasibility(compiled),
    sizes,
    sizes.map((_, index) => index),
    t,
    rngFor(options.seed, 'pairwise'),
    options.maxRows,
  );
  const targetIndex = compiled.dimensions.length - 1;
  const cells = array.rows.map((row) => {
    const situation: Record<string, string> = {};
    situations.forEach((dimension, index) => {
      const value = compiled.dimensions[index]?.values[row[index] ?? -1]?.id;
      if (value !== undefined) situation[dimension.id] = value;
    });
    const atom = compiled.dimensions[targetIndex]?.values[row[targetIndex] ?? -1]?.id ?? '';
    return { atom, dimension: dimensionOf.get(atom) ?? '', situation };
  });
  return {
    t,
    cells,
    allowed: array.allowed,
    covered: array.covered,
    situations: situations.map((dimension) => dimension.id),
    dropped,
  };
}
