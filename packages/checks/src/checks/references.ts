import { type Check, globMatches, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { entryKeys, listed, times } from '../support/values';

const NAME = 'references';

/**
 * `expect.references`: how many times the agent read a file matching each path or glob in the block,
 * with Count semantics, from `observed.runtime.references`. An adapter that reports no references list
 * observed nothing to check, so the check does not apply, as for stages.
 */
export const references: Check = {
  name: NAME,
  applies: (ctx) =>
    (ctx.expect.references?.length ?? 0) > 0 && ctx.observed.runtime?.references !== undefined,
  evaluate(ctx) {
    const expected = ctx.expect.references ?? [];
    const keys = entryKeys(expected.map((reference) => reference.path));
    const read = (ctx.observed.runtime?.references ?? []).map((reference) => reference.path);
    return expected.map((reference, index): Verdict => {
      const count = read.filter((path) => globMatches(reference.path, path)).length;
      return machineVerdict(
        NAME,
        keys[index] ?? reference.path,
        countAllows(reference.count, count) ? 'pass' : 'fail',
        `${reference.path} read ${times(count)}, expected ${describeCount(reference.count)}; files read in this block: ${listed([...new Set(read)])}`,
      );
    });
  },
};
