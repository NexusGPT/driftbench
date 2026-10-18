import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { AgentAdapter, Segment, Spec, ToolCall, WorldState } from '@agent-nexus/driftbench-core';
import { CONSTANT_REPLY, trivialAdapter } from '@agent-nexus/driftbench-generate';
import type { HiddenSpec } from './hidden';

/**
 * The cheater ladder (docs/validators.md section 3): code-only agents that try to pass a block without doing
 * the work. The constant and echo agents are the gate's own trivial agents. The other three are new here:
 * one copies every value of the Given into its reply, one calls every tool of the specification once per
 * turn with empty inputs, and one replays the hand-written suite's expected tool calls whatever the turn
 * asks. Like the gate's trivial agents, each reports the first stage the spec lists, so a Then that only
 * asks the agent to stay where it started is caught. A block any cheater passes is not a test.
 */

export const CHEATERS = ['constant', 'echo', 'copy-given', 'every-tool', 'replay-suite'] as const;
export type Cheater = (typeof CHEATERS)[number];

/** One expected call of the hand-written suite: the tool and the input its assertions pin down. */
export type ReplayCall = { tool: string; input: Record<string, unknown> };

/** Every distinct call the hand-written suite expects at least once, with its plain-value inputs. */
export function replayCalls(baseline: readonly Spec[]): ReplayCall[] {
  const seen = new Map<string, ReplayCall>();
  for (const spec of baseline) {
    for (const block of spec.blocks) {
      for (const tool of block.expect?.tools ?? []) {
        const count = tool.count;
        if (count === 0 || (typeof count === 'object' && count !== null && 'max' in count && count.max === 0))
          continue;
        const input: Record<string, unknown> = {};
        for (const [field, assertion] of Object.entries(tool.input ?? {})) {
          if (assertion === null || ['string', 'number', 'boolean'].includes(typeof assertion))
            input[field] = assertion;
        }
        const key = `${tool.label} ${JSON.stringify(input)}`;
        if (!seen.has(key)) seen.set(key, { tool: tool.label, input });
      }
    }
  }
  return [...seen.values()];
}

/** Every scalar found in the Given world, depth first, as text. */
export function givenValues(world: WorldState): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const entry of Array.isArray(value) ? value : Object.values(value)) walk(entry);
      return;
    }
    out.push(String(value));
  };
  walk(world);
  return out;
}

type Calls = { segments: Segment[]; toolCalls: ToolCall[]; payloads: { tool: string; input: unknown }[] };

function callAll(planned: readonly ReplayCall[], world: WorldState, into: Calls): void {
  planned.forEach(({ tool, input }, index) => {
    const id = `call-${index + 1}`;
    const override = world.tools?.[tool];
    into.segments.push({ type: 'tool_call', id, label: tool, input });
    if (override?.error !== undefined) {
      into.segments.push({ type: 'tool_result', id, label: tool, output: null, error: override.error });
      into.toolCalls.push({ id, label: tool, input, error: override.error });
      return;
    }
    const output = override?.result ?? {};
    into.segments.push({ type: 'tool_result', id, label: tool, output });
    into.toolCalls.push({ id, label: tool, input, output });
    into.payloads.push({ tool, input });
  });
}

/** The adapter of one cheater, for one spec. */
export function cheaterAdapter(
  name: Cheater,
  spec: Spec,
  hidden: HiddenSpec,
  replay: readonly ReplayCall[],
): AgentAdapter {
  if (name === 'constant' || name === 'echo') return trivialAdapter(name, spec);
  const stage = spec.stages?.[0];
  const everyTool: ReplayCall[] = hidden.tools.map((tool) => ({ tool: tool.name, input: {} }));
  type Session = { payloads: { tool: string; input: unknown }[] };
  return functionAdapter<Session>({
    create: () => ({ payloads: [] }),
    respond: (_messages, world, vars, session) => {
      const calls: Calls = { segments: [], toolCalls: [], payloads: session.payloads };
      if (name === 'every-tool') callAll(everyTool, world, calls);
      if (name === 'replay-suite') callAll(replay, world, calls);
      const copied = name === 'copy-given' ? [...givenValues(world), ...givenValues({ fixtures: vars })] : [];
      const text = copied.length > 0 ? `${CONSTANT_REPLY} ${copied.join(' ')}` : CONSTANT_REPLY;
      return {
        segments: [...calls.segments, { type: 'text', text }],
        text,
        toolCalls: calls.toolCalls,
        ...(stage === undefined ? {} : { runtime: { stages: [{ name: stage }] } }),
        cost: { usd: 0 },
        latencyMs: 0,
      };
    },
    payloads: (session) => session.payloads,
    deterministic: true,
    version: `cheater-${name}`,
  });
}
