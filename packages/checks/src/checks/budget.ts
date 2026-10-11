import { type Check, machineVerdict, type Observed, type Verdict } from '@driftbench/core';

const NAME = 'budget';

/**
 * The block budget: `steps`, `cost_usd` and `latency_ms` against what was observed.
 *
 * A step is one action of the agent: a tool call or a command. A runtime that records a command both as a
 * tool call and as an execution would count it twice, so the steps are the larger of the two lists, not
 * their sum. The cost is `observed.cost.usd`, or the sum of the segment costs when only those are
 * reported; with neither, the cost verdict is inconclusive and does not gate.
 */
export const budget: Check = {
  name: NAME,
  applies: (ctx) => {
    const limits = ctx.block.budget;
    return limits !== undefined && (limits.steps ?? limits.cost_usd ?? limits.latency_ms) !== undefined;
  },
  evaluate(ctx) {
    const limits = ctx.block.budget ?? {};
    const observed = ctx.observed;
    const verdicts: Verdict[] = [];

    if (limits.steps !== undefined) {
      const calls = observed.toolCalls.length;
      const commands = observed.executions?.length ?? 0;
      const steps = Math.max(calls, commands);
      verdicts.push(
        machineVerdict(
          NAME,
          'steps',
          steps <= limits.steps ? 'pass' : 'fail',
          `${steps} steps (${calls} tool calls, ${commands} commands), at most ${limits.steps}`,
        ),
      );
    }

    if (limits.cost_usd !== undefined) {
      const cost = costOf(observed);
      verdicts.push(
        cost === undefined
          ? machineVerdict(NAME, 'cost_usd', 'inconclusive', 'the adapter reported no cost for this block', {
              gating: false,
            })
          : machineVerdict(
              NAME,
              'cost_usd',
              cost <= limits.cost_usd ? 'pass' : 'fail',
              `cost ${cost} USD, at most ${limits.cost_usd}`,
            ),
      );
    }

    if (limits.latency_ms !== undefined) {
      verdicts.push(
        machineVerdict(
          NAME,
          'latency_ms',
          observed.latencyMs <= limits.latency_ms ? 'pass' : 'fail',
          `latency ${observed.latencyMs} ms, at most ${limits.latency_ms}`,
        ),
      );
    }
    return verdicts;
  },
};

function costOf(observed: Observed): number | undefined {
  if (observed.cost.usd !== undefined) return observed.cost.usd;
  const parts = observed.segments.flatMap((segment) =>
    segment.cost?.usd === undefined ? [] : [segment.cost.usd],
  );
  return parts.length === 0 ? undefined : parts.reduce((sum, part) => sum + part, 0);
}
