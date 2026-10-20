import type { DriverContext, DriverStep, Stimulus, UserDriver } from '@agent-nexus/driftbench-core';
import { SimulatedUserError } from './simulated';

/**
 * The scripted driver: replays the spec's blocks in order, each with its own stimulus, and stops after
 * the last one. It decides from its context alone, so one instance can drive any number of runs.
 *
 * A block whose `when.simulated_user` is `exact` or `replay` sends its user text, as written. A `simulated`
 * block is refused: its message is written by the agenda engine, which the scripted driver does not run, and
 * sending the authored text instead would report an exact result as a simulated one.
 */
export function createScriptedDriver(options: { allowSimulated?: boolean } = {}): UserDriver {
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
      return { kind: 'block', blockIndex: ctx.blockIndex, stimulus: sentOf(block.when, ctx, options) };
    },
  };
}

/** The stimulus as sent: a block's simulated user stays in the spec, never on the wire. */
function sentOf(when: Stimulus, ctx: DriverContext, options: { allowSimulated?: boolean }): Stimulus {
  if (!('user' in when) || when.simulated_user === undefined) return when;
  if (when.simulated_user.mode === 'simulated' && !options.allowSimulated) {
    throw new SimulatedUserError(
      `${ctx.spec.id}: block ${ctx.blockIndex} is simulated: run it with driftbench simulate and a model or a cassette`,
    );
  }
  return { user: when.user };
}
