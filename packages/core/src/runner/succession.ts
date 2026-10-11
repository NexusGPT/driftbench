import type { BlockResult, RunResult } from '../schema/run';

/**
 * Succession metrics over the blocks of one run, injected blocks included. A failing block is a drift
 * block: `firstDriftBlock` is its index, `driftRate` the share of failing blocks, `longestClean` the
 * longest stretch of passing blocks, and `minOverBlocks` holds when the run has blocks and every one passes.
 */
export function succession(blocks: readonly BlockResult[]): RunResult['succession'] {
  const first = blocks.find((block) => !block.pass);
  const driftCount = blocks.filter((block) => !block.pass).length;
  let longestClean = 0;
  let clean = 0;
  for (const block of blocks) {
    clean = block.pass ? clean + 1 : 0;
    longestClean = Math.max(longestClean, clean);
  }
  return {
    ...(first ? { firstDriftBlock: first.index } : {}),
    driftCount,
    driftRate: blocks.length === 0 ? 0 : driftCount / blocks.length,
    longestClean,
    minOverBlocks: blocks.length > 0 && driftCount === 0,
  };
}
