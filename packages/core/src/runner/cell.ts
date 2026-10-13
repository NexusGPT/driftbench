import { createHash } from 'node:crypto';
import type { RunResult } from '../schema/run';
import { canonicalJson } from '../spec/hash';

/** What makes a run cell: one spec version, on one target, in one mode, for one repeat (and perturbation). */
export type CellKey = Pick<RunResult, 'specHash' | 'target' | 'mode' | 'repeat' | 'perturbationId'>;

/**
 * The stable id of a cell, and the run id of its run: the first 16 hex characters of the SHA-256 of the
 * canonical JSON of its spec hash, target, mode, repeat and perturbation. The same computation as
 * `cellId` in @agent-nexus/driftbench-store, so a resumed campaign finds the runs the store holds. The campaign is
 * not part of it: the same cell in two campaigns has the same id.
 */
export function cellId(cell: CellKey): string {
  const { specHash, target, mode, repeat, perturbationId } = cell;
  const key = canonicalJson({ specHash, target, mode, repeat, perturbationId });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
