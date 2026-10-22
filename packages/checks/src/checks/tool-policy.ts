import {
  anyGlobMatches,
  type Check,
  callsIn,
  machineVerdict,
  type ToolCall,
  type ToolRule,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { times } from '../support/values';

const NAME = 'tool_policy';

export type { ToolRule };

/**
 * A run-wide tool policy over the calls every adapter records in a block. Each call takes the first rule whose
 * glob matches its tool name; a call no rule matches is allowed. A deny fails the block, one verdict per tool
 * named. An ask also fails: a check has no approver to ask, so the call is treated as denied.
 *
 * This check sees a call after the agent made it. A tool the harness runs itself is gated before it runs, by the
 * sandbox's approval policy; this check covers every tool a runtime reports, whatever adapter reported it.
 */
export function createToolPolicyCheck(rules: readonly ToolRule[]): Check {
  return {
    name: NAME,
    applies: (ctx) => rules.length > 0 && callsIn(ctx.observed, 'any').length > 0,
    evaluate(ctx) {
      const denied = new Map<string, { calls: ToolCall[]; rule: ToolRule }>();
      let checked = 0;
      for (const call of callsIn(ctx.observed, 'any')) {
        checked += 1;
        const rule = rules.find((candidate) => anyGlobMatches(candidate.pattern, call.label));
        if (!rule || rule.action === 'allow') continue;
        const entry = denied.get(call.label) ?? { calls: [], rule };
        entry.calls.push(call);
        denied.set(call.label, entry);
      }
      const verdicts: Verdict[] = [];
      for (const [label, { calls, rule }] of denied) {
        const ids = calls.map((call, index) => call.id ?? `call ${index + 1}`).join(', ');
        const why =
          rule.action === 'ask'
            ? `rule ${rule.pattern} asks, and a check has no approver, so it is denied`
            : `denied by rule ${rule.pattern}`;
        verdicts.push(
          machineVerdict(NAME, label, 'fail', `${label} called ${times(calls.length)} (${ids}); ${why}`),
        );
      }
      if (denied.size === 0) {
        verdicts.push(
          machineVerdict(NAME, 'calls', 'pass', `${times(checked)} checked, none denied by the tool policy`),
        );
      }
      return verdicts;
    },
  };
}
