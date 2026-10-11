import { createHash } from 'node:crypto';
import { canonicalJson, RunResult } from '@driftbench/core';
import { describeIssues, StoreError } from './errors';

/** What makes a run cell: one spec version, on one target, in one mode, for one repeat. */
export type CellKey = Pick<RunResult, 'specHash' | 'target' | 'mode' | 'repeat' | 'perturbationId'>;

const CellFields = RunResult.pick({
  specHash: true,
  target: true,
  mode: true,
  repeat: true,
  perturbationId: true,
});

/**
 * The stable id of a run cell: the first 16 hex characters of the SHA-256 of the cell's canonical
 * JSON. Key order and an absent `perturbationId` do not change it. The runner uses it as the run id,
 * so a resumed campaign finds the cells it already ran. A RunResult can be passed as it is.
 * The campaign is not part of the id: the same cell in two campaigns has the same id.
 */
export function cellId(cell: CellKey): string {
  const { specHash, target, mode, repeat, perturbationId } = cell;
  const parsed = CellFields.safeParse({ specHash, target, mode, repeat, perturbationId });
  if (!parsed.success) {
    throw new StoreError(
      'INVALID_RECORD',
      `cellId got an invalid cell: ${describeIssues(parsed.error.issues)}`,
    );
  }
  return createHash('sha256').update(canonicalJson(parsed.data)).digest('hex').slice(0, 16);
}
