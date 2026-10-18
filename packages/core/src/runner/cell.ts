import { createHash } from 'node:crypto';
import type { RunResult } from '../schema/run';
import { canonicalJson } from '../spec/hash';

/** What makes a run cell: one spec version, on one target, in one mode, for one repeat (and perturbation). */
export type CellKey = Pick<RunResult, 'specHash' | 'target' | 'mode' | 'repeat' | 'perturbationId'> & {
  /** The spec hash without the version label, when the cell knows it. The id reads it in place of `specHash`. */
  identityHash?: string;
};

/**
 * The stable id of a cell, and the run id of its run: the first 16 hex characters of the SHA-256 of the
 * canonical JSON of its spec identity hash, target, mode, repeat and perturbation. The identity hash is the spec
 * hash without the spec's `version` label (`identityHash`, else `specHash`), so a relabelled spec keeps its
 * cell ids. The same computation as
 * `cellId` in @agent-nexus/driftbench-store, so a resumed campaign finds the runs the store holds. The campaign is
 * not part of it: the same cell in two campaigns has the same id.
 */
export function cellId(cell: CellKey): string {
  const { target, mode, repeat, perturbationId } = cell;
  const specHash = cell.identityHash ?? cell.specHash;
  const key = canonicalJson({ specHash, target, mode, repeat, perturbationId });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * The id the cell had before the id left out the version label: made from `specHash` alone. Only a spec that
 * carries a `version` has one that differs from its `cellId`; a run stored then keeps that id.
 */
export function legacyCellId(cell: CellKey): string | undefined {
  if (cell.identityHash === undefined || cell.identityHash === cell.specHash) return undefined;
  return cellId({ ...cell, identityHash: undefined });
}
