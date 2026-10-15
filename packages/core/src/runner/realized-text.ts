import type { BlockResult, RunResult } from '../schema/run';
import { provenanceDigest, provenanceHash } from './provenance';

type Source = NonNullable<RunResult['realizedTextStripped']>;

/** A new record, never an edit of the source. Hashes and every other observation stay intact. */
export function applyBlockRealizedTextPolicy(
  block: BlockResult,
  recordRealizedText: boolean,
  source: Source,
): BlockResult {
  if (recordRealizedText || block.realized?.text === undefined) return block;
  return {
    ...block,
    realized: { hash: block.realized.hash },
    realizedTextStripped: source,
  };
}

/** Enforce the destination's opt-in before a copy is stored or exported. Never reconstruct missing text. */
export function applyRealizedTextPolicy(
  run: RunResult,
  recordRealizedText = false,
  source: Source = { fromRun: run.runId },
): RunResult {
  if (recordRealizedText) return run;
  const blocks = run.blocks.map((block) => applyBlockRealizedTextPolicy(block, false, source));
  if (blocks.every((block, index) => block === run.blocks[index])) return run;
  const stripped = { ...run, blocks, realizedTextStripped: source };
  return { ...stripped, provenanceDigest: provenanceDigest(stripped) };
}

/** Resolve only text supported by the stored observation. Missing text is never reconstructed. */
export function realizedTextOf(
  authored: string | undefined,
  realized?: BlockResult['realized'],
): string | undefined {
  if (realized === undefined) return authored;
  const text = realized.text ?? authored;
  return text !== undefined && provenanceHash(text) === realized.hash ? text : undefined;
}
