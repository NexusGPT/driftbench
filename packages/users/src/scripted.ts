import type { DriverContext, DriverStep, UserDriver } from '@driftbench/core';

/**
 * The scripted driver: replays the spec's blocks in order, each with its own stimulus, and stops after
 * the last one. It decides from its context alone, so one instance can drive any number of runs.
 */
export function createScriptedDriver(): UserDriver {
  return {
    id: 'scripted',
    next(ctx: DriverContext): DriverStep {
      const block = ctx.spec.blocks[ctx.blockIndex];
      if (!block) {
        return { kind: 'stop', reason: `the script ends after block ${ctx.spec.blocks.length - 1}` };
      }
      return { kind: 'block', blockIndex: ctx.blockIndex, stimulus: block.when };
    },
  };
}
