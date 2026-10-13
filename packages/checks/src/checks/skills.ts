import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { entryKeys, listed, times } from '../support/values';

const NAME = 'skills';

/**
 * `expect.skills`: how many times each skill loads in the block, with Count semantics, read from
 * `observed.runtime.skills`. A runtime trace without a skills list loaded none. Without any runtime trace
 * the adapter observed nothing, and each verdict is inconclusive. Order is not checked.
 */
export const skills: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.skills?.length ?? 0) > 0,
  evaluate(ctx) {
    const expected = ctx.expect.skills ?? [];
    const keys = entryKeys(expected.map((skill) => skill.name));
    const runtime = ctx.observed.runtime;
    const loaded = (runtime?.skills ?? []).map((skill) => skill.name);
    return expected.map((skill, index): Verdict => {
      const id = keys[index] ?? skill.name;
      if (runtime === undefined) {
        return machineVerdict(
          NAME,
          id,
          'inconclusive',
          `${skill.name}: the adapter reported no runtime trace, so no skill could be seen`,
        );
      }
      const count = loaded.filter((name) => name === skill.name).length;
      return machineVerdict(
        NAME,
        id,
        countAllows(skill.count, count) ? 'pass' : 'fail',
        `${skill.name} loaded ${times(count)}, expected ${describeCount(skill.count)}; skills loaded in this block: ${listed(loaded)}`,
      );
    });
  },
};
