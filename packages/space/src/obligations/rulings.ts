import { contentHash } from '@agent-nexus/driftbench-core';

/**
 * What a generated suite owes, written once as data. A block of a suite is a repeat of another block when they are
 * the same test; it may go only when it is not the sole holder of an obligation the suite owes. The rulings say
 * which obligations those are and when a holder is kept. They are the ruling of docs/validators.md, section 3
 * ("Same test"). The generator validator reads them; the generator moves its own checks onto them, one at a time,
 * so that the two cannot rule differently.
 *
 * - `family`: a metamorphic variant in range is owed once per path, walk and words. With `cutAs: unit`, the
 *   variants of one walk are cut together: they land on one new walk and keep as many distinct words, and their
 *   keys are then carried to the new walk. With `cutAs: single` a cut of a variant loses its key.
 * - `probe`: a class a block injects is owed once per path and class.
 * - `perturb`: a class a declared perturbation reaches a block with is owed once per path and class. A cut takes the
 *   declaration with its block; it is lost only when no other spec declares the class on the path.
 * - `twin`: a written walk and a copy of it that differs in one axis alone are owed once per path and axis; the
 *   spec in every pair of the axis is kept. With `onlyDeclared`, both values of a pair must be ones the map
 *   declares, so a copy that names no channel (or no persona) is no twin.
 *
 * `keptWhen` is `sole-holder` when a holder is kept only if no other spec holds the obligation, and `any-holder`
 * when every holder is kept. A kind the list does not hold is owed by nobody.
 */
export type ObligationKind =
  | { id: 'probe' | 'perturb'; keptWhen: 'sole-holder' | 'any-holder' }
  | { id: 'family'; keptWhen: 'sole-holder' | 'any-holder'; cutAs: 'unit' | 'single' }
  | { id: 'twin'; axes: readonly ('channel' | 'persona')[]; onlyDeclared: boolean };

/**
 * What a cut shape must not break, whatever it keeps. The generator validator does not read these rules until each
 * has an item of its own that fails a product breaking it; the cut of a suite reads them now.
 *
 * - `toolFailureLast`, `restatedLast`, `driverBuildable`: the walk does not end on a tool failure, does not end on a
 *   restated request, and keeps every declared perturbation buildable. The caller evaluates them (they need the
 *   spec and the users package) and reports the ones a shape breaks in `ObligationSpec.broken`.
 * - `oneWalkPerEnd`: exactly one walk of more than one block ends on a given test. `keeps` says which: the lowest id.
 * - `dropWhole`: a spec may be dropped from the suite only once it is cut to `maxBlocks` blocks.
 */
export type ValidityRule =
  | { id: 'toolFailureLast' | 'restatedLast' | 'driverBuildable' }
  | { id: 'oneWalkPerEnd'; keeps: 'lowest-id' }
  | { id: 'dropWhole'; maxBlocks: number };

export type Rulings = {
  /** Changes with any change of a ruling. */
  version: number;
  /** Where the ruling is written in prose. */
  doc: string;
  obligations: readonly ObligationKind[];
  validity: readonly ValidityRule[];
};

export const RULINGS: Rulings = {
  version: 2,
  doc: 'docs/validators.md, section 3, Same test',
  obligations: [
    { id: 'family', keptWhen: 'sole-holder', cutAs: 'unit' },
    { id: 'probe', keptWhen: 'sole-holder' },
    { id: 'perturb', keptWhen: 'sole-holder' },
    { id: 'twin', axes: ['channel', 'persona'], onlyDeclared: true },
  ],
  validity: [
    { id: 'toolFailureLast' },
    { id: 'restatedLast' },
    { id: 'driverBuildable' },
    { id: 'oneWalkPerEnd', keeps: 'lowest-id' },
    { id: 'dropWhole', maxBlocks: 1 },
  ],
};

/** A short hash of the rulings: two sides that read the same rulings print the same one. */
export function rulingsHash(rulings: Rulings = RULINGS): string {
  return contentHash(rulings);
}
