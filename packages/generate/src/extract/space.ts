import { DEFAULT_MAX_CELLS, gridSize, NONE, type SpaceMap, validateSpaceMap } from '@driftbench/space';
import {
  type DimensionKind,
  type Proposal,
  type ProposalDimension,
  type ProposalIssue,
  type Role,
  valueApproved,
} from './proposal';

/**
 * A proposal holds a space map waiting for approval: its axis dimensions, with their values and the
 * constraints among them. `toSpaceMap` drops the evidence, the flags and the detail dimensions and gives the
 * map the space package reads, so every proposal the extractor writes must pass `validateSpaceMap`. Detail
 * dimensions stay in the proposal: the generator varies them inside a cell, as boundary values.
 */

/** Kinds a spec places on through one field: a map holds one dimension of each. */
export const SINGLE_KINDS: ReadonlySet<DimensionKind> = new Set(['stage', 'deviation', 'channel']);

/**
 * The role code proposes for a new dimension. A tool-schema dimension is a detail. Any other dimension is
 * an axis when no earlier dimension of its kind is one, and a detail otherwise: one axis per kind, as the
 * hand-written maps have, so the full grid stays small enough to count coverage on. Order decides: the
 * inventory first, then the tool schemas, then the model sections in order. A person may flip any role.
 */
export function proposeRole(
  dimensions: readonly ProposalDimension[],
  kind: DimensionKind,
  fromToolSchema: boolean,
): Role {
  if (fromToolSchema) return 'detail';
  return dimensions.some((dimension) => dimension.kind === kind && dimension.role === 'axis')
    ? 'detail'
    : 'axis';
}

export type SpaceMapOptions = {
  /** Keep only approved values (a dimension's flag or the value's own) and approved constraints. */
  approvedOnly?: boolean;
};

/**
 * The space map of a proposal: its axis dimensions only. The deviation dimension gets the reserved value
 * `none` (a block with no deviation), as a seeded map does: it is a cell of every conversation, not a claim
 * about the agent. A dimension left with no value is dropped, and so is a constraint whose values are not
 * all in the map. The inventory path is the proposal's, so write the map in the proposal's folder. The
 * prior is declared with no weight: every value of a dimension weighs the same until the owner says so.
 */
export function toSpaceMap(proposal: Proposal, options: SpaceMapOptions = {}): SpaceMap {
  const dimensions = proposal.dimensions
    .filter((dimension) => dimension.role === 'axis')
    .flatMap((dimension) => {
      const values = dimension.values
        .filter((value) => !options.approvedOnly || valueApproved(dimension, value))
        .map((value) => ({ id: value.id, title: value.title }));
      if (values.length > 0 && dimension.kind === 'deviation' && !values.some((value) => value.id === NONE)) {
        values.unshift({ id: NONE, title: 'No deviation' });
      }
      return values.length === 0
        ? []
        : [{ id: dimension.id, title: dimension.title, kind: dimension.kind, values }];
    });
  const listed = new Map(
    dimensions.map((dimension) => [dimension.id, new Set(dimension.values.map((value) => value.id))]),
  );
  const constraints = proposal.constraints
    .filter((constraint) => !options.approvedOnly || constraint.approved)
    .filter((constraint) =>
      Object.entries(constraint.forbid).every(([dimension, value]) => listed.get(dimension)?.has(value)),
    )
    .map((constraint) => ({ forbid: { ...constraint.forbid }, reason: constraint.reason }));
  const inventory = proposal.sources.find((source) => source.kind === 'inventory')?.path;
  return {
    version: String(proposal.version),
    agent: proposal.agent,
    ...(inventory === undefined ? {} : { inventory }),
    dimensions,
    constraints,
    prior: { kind: 'declared' },
  };
}

/** The cells of the full grid of the axis dimensions, and whether the space commands accept that many. */
export function axisGrid(
  proposal: Proposal,
  options: SpaceMapOptions = {},
): { cells: number; limit: number } {
  return { cells: gridSize(toSpaceMap(proposal, options)), limit: DEFAULT_MAX_CELLS };
}

/**
 * The problems `validateSpaceMap` finds in the proposal's map of axes, every entry counted. Paths point into
 * the map, which holds the axis dimensions only, the deviation dimension starting with `none`.
 */
export function checkSpaceMap(proposal: Proposal): ProposalIssue[] {
  const map = toSpaceMap(proposal);
  if (map.dimensions.length === 0) return [];
  const result = validateSpaceMap(map);
  if (result.ok) return [];
  return result.errors.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: `as a space map: ${issue.message}`,
  }));
}
