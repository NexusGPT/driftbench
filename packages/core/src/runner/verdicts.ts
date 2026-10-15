import type { BlockResult, BlockStatus, RunResult } from '../schema/run';

/**
 * The four block verdicts. `pass` and `fail` are measurements; `not_run` and `blocked` are not, so every
 * pass rate leaves them out and prints their count beside it. A record written before `status` existed
 * reads as pass or fail from its `pass` field.
 */
export function blockStatus(block: Pick<BlockResult, 'pass' | 'status'>): BlockStatus {
  return block.status ?? (block.pass ? 'pass' : 'fail');
}

/** True for a pass or a fail: a block the agent was measured on. */
export function isScored(block: Pick<BlockResult, 'pass' | 'status'>): boolean {
  const status = blockStatus(block);
  return status === 'pass' || status === 'fail';
}

/**
 * A run's verdict over its blocks, by the runner's rule. `fail` when the run did not complete, ended on a
 * failure verdict, ran no block, failed a scored block or missed its end state: a measured failure stands
 * whatever else the run holds. Otherwise `not_run` when a block was not run, `blocked` when a block was
 * blocked, and `pass` when every block passed.
 */
export type RunOutcome = BlockStatus;

export function runOutcome(
  run: Pick<RunResult, 'blocks' | 'status' | 'endState'> & Partial<Pick<RunResult, 'endVerdict'>>,
): RunOutcome {
  const statuses = run.blocks.map(blockStatus);
  if (statuses.includes('fail')) return 'fail';
  if (run.status !== 'completed') return 'fail';
  if (run.endVerdict !== undefined && run.endVerdict !== 'success') return 'fail';
  if (run.endState?.match === false) return 'fail';
  if (statuses.length === 0) return 'fail';
  if (statuses.includes('not_run')) return 'not_run';
  if (statuses.includes('blocked')) return 'blocked';
  return 'pass';
}

/**
 * The run's outcome over its blocks and its end state, without the end verdict: for the readers that judge the
 * end verdict apart, or not at all. Every reader of a run's pass goes through this or `runOutcome`, never
 * through `block.pass`, so a block not run or blocked is never read as a failure.
 */
export function blocksOutcome(run: Pick<RunResult, 'blocks' | 'status' | 'endState'>): RunOutcome {
  return runOutcome({
    blocks: run.blocks,
    status: run.status,
    ...(run.endState ? { endState: run.endState } : {}),
  });
}

/**
 * Why a block was not run or blocked, in one line: `not run (unsupported, check capability): expected ...; got
 * ...` or `blocked by <block> (root <block>)`. Undefined for a pass or a fail.
 */
export function skipReason(
  block: Pick<BlockResult, 'pass' | 'status' | 'notRun' | 'blocked'>,
): string | undefined {
  const status = blockStatus(block);
  if (status === 'pass' || status === 'fail') return undefined;
  if (block.notRun)
    return `not run (${block.notRun.kind}, check ${block.notRun.check}): expected ${block.notRun.expected}; got ${block.notRun.got}`;
  if (block.blocked) return `blocked by ${block.blocked.by} (root ${block.blocked.root})`;
  return status === 'blocked' ? 'blocked' : 'not run';
}

/** Runs and blocks by verdict, for the counts printed beside a pass rate. */
export type VerdictCounts = { pass: number; fail: number; not_run: number; blocked: number };

export function countRuns(runs: readonly RunResult[]): VerdictCounts {
  const counts: VerdictCounts = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
  for (const run of runs) counts[runOutcome(run)] += 1;
  return counts;
}

export function countBlocks(blocks: readonly Pick<BlockResult, 'pass' | 'status'>[]): VerdictCounts {
  const counts: VerdictCounts = { pass: 0, fail: 0, not_run: 0, blocked: 0 };
  for (const block of blocks) counts[blockStatus(block)] += 1;
  return counts;
}

/** `2 not run, 1 blocked`, or the empty string when both are 0: what follows a pass rate. */
export function unscoredText(counts: Pick<VerdictCounts, 'not_run' | 'blocked'>): string {
  const parts = [
    ...(counts.not_run > 0 ? [`${counts.not_run} not run`] : []),
    ...(counts.blocked > 0 ? [`${counts.blocked} blocked`] : []),
  ];
  return parts.join(', ');
}
