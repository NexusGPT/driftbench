import { NONE, type SpaceMap, validateSpaceMap } from '@driftbench/space';
import type { DimensionKind, Proposal, ProposalIssue } from './proposal';

/**
 * A proposal is a space map waiting for approval: the same dimensions, values and constraints, plus the
 * evidence and the flags. `toSpaceMap` drops the evidence and gives the map the space package reads, so
 * every proposal the extractor writes must pass `validateSpaceMap`.
 */

/** Kinds a spec places on through one field: a map holds one dimension of each. */
export const SINGLE_KINDS: ReadonlySet<DimensionKind> = new Set(['stage', 'deviation', 'channel']);

export type SpaceMapOptions = {
  /** Keep only approved values and constraints; a dimension left with no value is dropped. */
  approvedOnly?: boolean;
};

/**
 * The space map of a proposal. The deviation dimension gets the reserved value `none` (a block with no
 * deviation), as a seeded map does: it is a cell of every conversation, not a claim about the agent. The
 * inventory path is the proposal's, so write the map in the proposal's folder. The prior is declared with
 * no weight: every value of a dimension weighs the same until the owner says otherwise.
 */
export function toSpaceMap(proposal: Proposal, options: SpaceMapOptions = {}): SpaceMap {
  const keep = (approved: boolean) => !options.approvedOnly || approved;
  const dimensions = proposal.dimensions.flatMap((dimension) => {
    const values = dimension.values
      .filter((value) => keep(value.approved))
      .map((value) => ({ id: value.id, title: value.title }));
    if (dimension.kind === 'deviation' && !values.some((value) => value.id === NONE)) {
      values.unshift({ id: NONE, title: 'No deviation' });
    }
    return values.length === 0
      ? []
      : [{ id: dimension.id, title: dimension.title, kind: dimension.kind, values }];
  });
  const listed = new Map(
    dimensions.map((dimension) => [dimension.id, new Set(dimension.values.map((v) => v.id))]),
  );
  const constraints = proposal.constraints
    .filter((constraint) => keep(constraint.approved))
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

/**
 * The problems `validateSpaceMap` finds in the proposal's map, every entry counted. Paths point into the
 * map, where the deviation dimension starts with `none`.
 */
export function checkSpaceMap(proposal: Proposal): ProposalIssue[] {
  if (proposal.dimensions.length === 0) return [];
  const result = validateSpaceMap(toSpaceMap(proposal));
  if (result.ok) return [];
  return result.errors.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: `as a space map: ${issue.message}`,
  }));
}
