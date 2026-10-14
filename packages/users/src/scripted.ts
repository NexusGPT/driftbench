import type { DriverContext, DriverStep, UserDriver } from '@agent-nexus/driftbench-core';

/**
 * The scripted driver: replays the spec's blocks in order, each with its own stimulus, and stops after
 * the last one. It decides from its context alone, so one instance can drive any number of runs.
 */
export function createScriptedDriver(): UserDriver {
  return {
    id: 'scripted',
    seeds: {},
    next(ctx: DriverContext): DriverStep {
      const end = ctx.spec.end;
      const stopAfter = end ? (end.atBlock ?? ctx.spec.blocks.length - 1) : undefined;
      if (end && stopAfter !== undefined && ctx.blockIndex > stopAfter) {
        return {
          kind: 'stop',
          reason: end.reason ?? `the script ends with ${end.verdict}`,
          verdict: end.verdict,
        };
      }
      const block = ctx.spec.blocks[ctx.blockIndex];
      if (!block) {
        if (end) {
          return {
            kind: 'stop',
            reason: end.reason ?? `the script ends with ${end.verdict}`,
            verdict: end.verdict,
          };
        }
        return { kind: 'stop', reason: `the script ends after block ${ctx.spec.blocks.length - 1}` };
      }
      return { kind: 'block', blockIndex: ctx.blockIndex, stimulus: block.when };
    },
  };
}
