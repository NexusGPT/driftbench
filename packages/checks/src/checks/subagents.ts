import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { entryKeys, listed, times } from '../support/values';

const NAME = 'subagents';

/**
 * `expect.subagents`: how many times the agent dispatched each helper in the block, by name and, when
 * the spec gives one, model, with Count semantics, from `observed.runtime.subagents`. An adapter that
 * reports no subagents list observed nothing to check, so the check does not apply, as for stages.
 */
export const subagents: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.subagents?.length ?? 0) > 0 && ctx.observed.runtime?.subagents !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.subagents ?? [];
    const keys = entryKeys(
      expected.map((helper) => (helper.model ? `${helper.name}.${helper.model}` : helper.name)),
    );
    const ran = ctx.observed.runtime?.subagents ?? [];
    const shown = ran.map((helper) => (helper.model ? `${helper.name} (${helper.model})` : helper.name));
    return expected.map((helper, index): Verdict => {
      const count = ran.filter(
        (one) => one.name === helper.name && (helper.model === undefined || one.model === helper.model),
      ).length;
      const which = helper.model ? `${helper.name} on model ${helper.model}` : helper.name;
      return machineVerdict(
        NAME,
        keys[index] ?? helper.name,
        countAllows(helper.count, count) ? 'pass' : 'fail',
        `${which} dispatched ${times(count)}, expected ${describeCount(helper.count)}; helpers dispatched in this block: ${listed(shown)}`,
      );
    });
  },
};
