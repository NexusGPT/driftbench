import type { ToolCall } from '../schema/run';
import { anyGlobMatches } from '../spec/glob';

/**
 * A tool policy over the tool calls a block records. A rule's glob matches the tool name. The first rule that
 * matches a call decides it; a call no rule matches is allowed. An `ask` has no approver here, so it is denied.
 */
export type ToolRule = { pattern: string; action: 'allow' | 'deny' | 'ask' };

/** The rule that decides a tool name, or undefined when none matches (the call is allowed). */
export function decideToolRule(rules: readonly ToolRule[], label: string): ToolRule | undefined {
  return rules.find((rule) => anyGlobMatches(rule.pattern, label));
}

/** True when the rule denies the call: a deny, or an ask with no approver to say yes. */
export function deniesCall(rule: ToolRule | undefined): boolean {
  return rule !== undefined && rule.action !== 'allow';
}

/**
 * The calls with the denied ones marked: a denied call keeps its label and input, loses its output, and carries an
 * error that names the rule. Allowed calls are returned as they were. The gate never drops a call, so the record
 * still shows what the agent tried.
 */
export function gateToolCalls(calls: readonly ToolCall[], rules: readonly ToolRule[]): ToolCall[] {
  if (rules.length === 0) return [...calls];
  return calls.map((call) => {
    const rule = decideToolRule(rules, call.label);
    if (!deniesCall(rule)) return call;
    const why =
      rule?.action === 'ask'
        ? `tool policy rule ${rule.pattern} asks, and no approver answers, so the call is denied`
        : `denied by tool policy rule ${rule?.pattern ?? ''}`;
    const { output: _dropped, ...kept } = call;
    return { ...kept, error: why };
  });
}
