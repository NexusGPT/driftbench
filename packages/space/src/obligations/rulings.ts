import { contentHash } from '@agent-nexus/driftbench-core';

/**
 * What a generated suite owes, written once as data. A block of a suite is a repeat of another block when they are
 * the same test; it may go only when it is not the sole holder of an obligation the suite owes. The rulings say
 * which obligations those are and when a holder is kept. They are the ruling of docs/validators.md, section 3
 * ("Same test"). The generator validator reads them; the generator moves its own checks onto them, one at a time,
 * so that the two cannot rule differently.
 *
 * - `family`: a metamorphic variant in range is owed once per path, walk and words.
 * - `probe`: a class a block injects is owed once per path and class.
 * - `perturb`: a class a declared perturbation reaches a block with is owed once per path and class.
 * - `twin`: a written walk and a copy of it that differs in one axis alone are owed once per path and axis; the
 *   spec in every pair of the axis is kept. With `onlyDeclared`, both values of a pair must be ones the map
 *   declares, so a copy that names no channel (or no persona) is no twin.
 *
 * `keptWhen` is `sole-holder` when a holder is kept only if no other spec holds the obligation, and `any-holder`
 * when every holder is kept. A kind the list does not hold is owed by nobody.
 */
export type ObligationKind =
  | { id: 'family' | 'probe' | 'perturb'; keptWhen: 'sole-holder' | 'any-holder' }
  | { id: 'twin'; axes: readonly ('channel' | 'persona')[]; onlyDeclared: boolean };

export type Rulings = {
  /** Changes with any change of a ruling. */
  version: number;
  /** Where the ruling is written in prose. */
  doc: string;
  obligations: readonly ObligationKind[];
};

export const RULINGS: Rulings = {
  version: 1,
  doc: 'docs/validators.md, section 3, Same test',
  obligations: [
    { id: 'family', keptWhen: 'sole-holder' },
    { id: 'probe', keptWhen: 'sole-holder' },
    { id: 'perturb', keptWhen: 'sole-holder' },
    { id: 'twin', axes: ['channel', 'persona'], onlyDeclared: true },
  ],
};

/** A short hash of the rulings: two sides that read the same rulings print the same one. */
export function rulingsHash(rulings: Rulings = RULINGS): string {
  return contentHash(rulings);
}
