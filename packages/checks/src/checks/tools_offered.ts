import { type Check, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { listed } from '../support/values';

const NAME = 'tools_offered';

/**
 * `expect.tools_offered`: which tools the runtime offered the agent in the block, read from
 * `observed.runtime.offered`. `include` names tools that must be offered, `exclude` tools that must not be:
 * a tool a setting denies is not offered, so a deleted or added deny rule shows here even when the agent
 * never calls the tool. Calls do not count. Without an offered list (no runtime trace, or a runtime that does
 * not report it) each verdict is inconclusive.
 */
export const toolsOffered: Check = {
  name: NAME,
  applies: (ctx) =>
    (ctx.expect.tools_offered?.include?.length ?? 0) + (ctx.expect.tools_offered?.exclude?.length ?? 0) > 0,
  evaluate(ctx) {
    const expected = ctx.expect.tools_offered ?? {};
    const offered = ctx.observed.runtime?.offered;
    const verdict = (side: 'include' | 'exclude', tool: string): Verdict => {
      const id = `${side}.${tool}`;
      if (offered === undefined) {
        return machineVerdict(
          NAME,
          id,
          'inconclusive',
          `${tool}: the adapter reported no offered tools, so whether it was offered cannot be seen`,
        );
      }
      const present = offered.includes(tool);
      const pass = side === 'include' ? present : !present;
      return machineVerdict(
        NAME,
        id,
        pass ? 'pass' : 'fail',
        `${tool} was ${present ? '' : 'not '}offered, expected ${side === 'include' ? '' : 'not '}offered; tools offered in this block: ${listed(offered)}`,
      );
    };
    return [
      ...(expected.include ?? []).map((tool) => verdict('include', tool)),
      ...(expected.exclude ?? []).map((tool) => verdict('exclude', tool)),
    ];
  },
};
