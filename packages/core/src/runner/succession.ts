import type { BlockResult, RunResult } from '../schema/run';
import { blockStatus } from './verdicts';

/**
 * Succession metrics over the blocks of one run, injected blocks included. A failing block is a drift
 * block: `firstDriftBlock` is its index, `driftRate` the share of failing blocks, `longestClean` the
 * longest stretch of passing blocks, and `minOverBlocks` holds when the run has blocks and every one passes.
 * A not_run or blocked block is neither: it is left out of the rate and ends a clean stretch.
 */
export function succession(blocks: readonly BlockResult[]): RunResult['succession'] {
  const statuses = blocks.map(blockStatus);
  const first = blocks.find((_, index) => statuses[index] === 'fail');
  const driftCount = statuses.filter((status) => status === 'fail').length;
  const scored = statuses.filter((status) => status === 'pass' || status === 'fail').length;
  let longestClean = 0;
  let clean = 0;
  for (const status of statuses) {
    clean = status === 'pass' ? clean + 1 : 0;
    longestClean = Math.max(longestClean, clean);
  }
  return {
    ...(first ? { firstDriftBlock: first.index } : {}),
    driftCount,
    driftRate: scored === 0 ? 0 : driftCount / scored,
    longestClean,
    minOverBlocks: blocks.length > 0 && statuses.every((status) => status === 'pass'),
  };
}
