import { type Check, type CheckContext, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { listed } from '../support/values';

const NAME = 'stage';

type ObservedStage = { name: string; block: number; own: string[] };

/**
 * `expect.stage` against the stage the runtime reports: the last entry of the block's
 * `runtime.stages`. A runtime that reports a stage only when it changes leaves a block without one; in a
 * free-running or perturbed run the session carries on, so the last stage reported by an earlier block
 * still holds. When no stage was ever reported the check does not apply: the step classifier (`classifyStage` in
 * core) owns that case. `stage_reported: true` separately requires a stage in this block, even without an
 * expected stage name. Entries marked carried, history and the classifier cannot satisfy that assertion.
 */
export const stage: Check = {
  name: NAME,
  applies: (ctx) =>
    ctx.expect.stage_reported === true ||
    (ctx.expect.stage !== undefined && observedStage(ctx) !== undefined),
  evaluate(ctx) {
    const verdicts: Verdict[] = [];
    if (ctx.expect.stage_reported === true) {
      const own = (ctx.observed.runtime?.stages ?? [])
        .filter((entry) => entry.carried !== true)
        .map((entry) => entry.name)
        .filter((name) => name.trim().length > 0);
      verdicts.push(
        machineVerdict(
          NAME,
          'reported',
          own.length > 0 ? 'pass' : 'fail',
          own.length > 0
            ? `runtime reported stages in this block: ${listed(own)}`
            : 'runtime reported no stage in this block; carried and inferred stages do not count',
        ),
      );
    }
    const expected = ctx.expect.stage;
    const seen = observedStage(ctx);
    if (expected === undefined || seen === undefined) return verdicts;
    const where =
      seen.block === ctx.blockIndex
        ? `stages in this block: ${listed(seen.own)}`
        : `no stage reported in this block; the last one, from block ${seen.block}, still holds`;
    verdicts.push(
      machineVerdict(
        NAME,
        'reached',
        seen.name === expected ? 'pass' : 'fail',
        `reached ${seen.name}, expected ${expected} (${where})`,
      ),
    );
    return verdicts;
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
