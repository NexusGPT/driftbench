import { type Check, type CheckContext, machineVerdict } from '@driftbench/core';
import { listed } from '../support/values';

const NAME = 'stage';

type ObservedStage = { name: string; block: number; own: string[] };

/**
 * `expect.stage` against the stage the runtime reports: the last entry of the block's
 * `runtime.stages`. A runtime that reports a stage only when it changes leaves a block without one; in a
 * free-running or perturbed run the session carries on, so the last stage reported by an earlier block
 * still holds. When no stage was ever reported the check does not apply: the stage classifier of phase 3
 * owns that case.
 */
export const stage: Check = {
  name: NAME,
  applies: (ctx) => ctx.expect.stage !== undefined && observedStage(ctx) !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.stage;
    const seen = observedStage(ctx);
    if (expected === undefined || seen === undefined) return [];
    const where =
      seen.block === ctx.blockIndex
        ? `stages in this block: ${listed(seen.own)}`
        : `no stage reported in this block; the last one, from block ${seen.block}, still holds`;
    return [
      machineVerdict(
        NAME,
        'reached',
        seen.name === expected ? 'pass' : 'fail',
        `reached ${seen.name}, expected ${expected} (${where})`,
      ),
    ];
  },
};

function observedStage(ctx: CheckContext): ObservedStage | undefined {
  const own = (ctx.observed.runtime?.stages ?? []).map((entry) => entry.name);
  const last = own.at(-1);
  if (last !== undefined) return { name: last, block: ctx.blockIndex, own };
  if (ctx.mode === 'T') return undefined;
  for (const block of [...ctx.history].reverse()) {
    const name = block.observed.runtime?.stages?.at(-1)?.name;
    if (name !== undefined) return { name, block: block.index, own };
  }
  return undefined;
}
