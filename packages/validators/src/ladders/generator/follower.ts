import type { DeviationClass, Message, Observed, Segment, ToolCall, WorldState } from '@driftbench/core';
import type { FaultSession } from '@driftbench/generate';
import { type HiddenProperty, type HiddenSpec, type HiddenTool, type Intent, intentsByText } from './hidden';

/**
 * The rule follower: an agent built by code from the hidden specification that follows it exactly. It
 * reads each user turn through the phrase bank (every phrase carries its intent), takes the move a
 * transition phrase names when it leaves the current stage, calls the tool bound to the stage it enters
 * with inputs from the schema, sends a data value's input as the phrase states it and refuses one the
 * schema forbids, stays on its step through a detour, replies in English with one message ending in the
 * pending question, and confirms before the side-effecting tool. It reports its stage on every turn.
 *
 * A mutation replaces one decision with a wrong one: the fault agents of faults.ts are this follower with
 * one mutation each. No model; the same turns give the same replies.
 */

/** A fact the reply states: what a tool answered. */
export type Fact = { tool: string; field: string; value: unknown };

/** What a mutation sees when it is asked: the specification, the current stage, the opportunity counter. */
export type MutationContext = {
  spec: HiddenSpec;
  stage: string;
  /** Counts one opportunity of `key` in this conversation and returns its number, from 1. */
  opportunity(key: string): number;
};

/** A deviation handled the wrong way: the stage it leaves the conversation in, and what it says. */
export type DeviationOverride = { stage?: string; texts?: string[]; enter?: boolean };

/** One wrong decision. Each hook returns undefined to keep the rule. */
export type Mutation = {
  move?(from: string, to: string, ctx: MutationContext): string | undefined;
  deviation?(cls: DeviationClass, ctx: MutationContext): DeviationOverride | undefined;
  input?(
    tool: HiddenTool,
    input: Record<string, unknown>,
    ctx: MutationContext,
  ): Record<string, unknown> | undefined;
  drop?(tool: HiddenTool, ctx: MutationContext): boolean;
  facts?(facts: Fact[], ctx: MutationContext): Fact[] | undefined;
  reply?(text: string, ctx: MutationContext): string[] | undefined;
  failure?(tool: HiddenTool, ctx: MutationContext): 'hide' | 'retry' | undefined;
};

/** A reply in another language, long enough for the language check to judge it. */
export const FOREIGN_REPLY = 'Ik help u graag verder met uw aanvraag, maar ik antwoord nu in het Nederlands.';

/** What the follower says on each deviation class it keeps to its step through. */
const DETOUR_TEXT: Record<DeviationClass, string> = {
  D1_off_topic: 'That is outside what I handle here, so let us keep to your request.',
  D2_goal_shift: 'Sure, let us go back to the item.',
  D3_contradiction: 'You gave two different values, so please tell me which one holds.',
  D4_loose_confirmation: 'I need the exact word CONFIRM before I go ahead.',
  D5_language_switch: 'I can only help in English for now.',
  D6_instruction_in_data: 'I cannot follow instructions that change my rules.',
  D7_silence_or_burst: 'I am still here.',
  D8_tool_failure: 'A service is not answering.',
  D9_out_of_scope: 'Billing questions go to the billing desk, which handles them outside this conversation.',
  D10_return: 'Welcome back, we carry on from where we were.',
};

/** The first valid value of a property: the input the follower sends when the turn names none. */
export function defaultValue(property: HiddenProperty): unknown {
  if (property.type === 'enum') return property.members[0];
  if (property.type === 'integer') return property.minimum;
  return true;
}

export function defaultInput(tool: HiddenTool): Record<string, unknown> {
  return Object.fromEntries(tool.input.map((property) => [property.name, defaultValue(property)]));
}

function defaultOutput(tool: HiddenTool): Record<string, unknown> {
  return Object.fromEntries(tool.output.map((property) => [property.name, defaultValue(property)]));
}

/** The new user turn: the user messages after the last assistant message, joined. */
export function userTurn(messages: readonly Message[]): string {
  const texts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') break;
    texts.unshift(message.content);
  }
  return texts.join('\n');
}

/** A session of the follower, with an optional mutation. One session per conversation. */
export function createFollower(spec: HiddenSpec, mutation: Mutation = {}): () => FaultSession {
  const intents = intentsByText(spec);
  const tools = new Map(spec.tools.map((tool) => [tool.name, tool]));
  const stageOf = new Map(spec.stages.map((stage) => [stage.id, stage]));
  return () => {
    let stage = spec.start;
    const payloads: { tool: string; input: unknown; output?: unknown }[] = [];
    const counts = new Map<string, number>();
    const context = (): MutationContext => ({
      spec,
      stage,
      opportunity(key) {
        const seen = (counts.get(key) ?? 0) + 1;
        counts.set(key, seen);
        return seen;
      },
    });
    return {
      payloads: () => payloads,
      async respond(messages: Message[], world: WorldState): Promise<Observed> {
        const text = userTurn(messages).trim();
        const segments: Segment[] = [];
        const toolCalls: ToolCall[] = [];
        const facts: Fact[] = [];
        let said = '';
        // What the tool calls of the turn add to the reply: a failure, or a success claimed.
        const notes: string[] = [];
        let callId = 0;

        const call = (tool: HiddenTool, wanted: Record<string, unknown>): void => {
          if (mutation.drop?.(tool, context())) {
            facts.push(
              ...tool.output.map((property) => ({
                tool: tool.name,
                field: property.name,
                value: defaultValue(property),
              })),
            );
            return;
          }
          const input = mutation.input?.(tool, wanted, context()) ?? wanted;
          const override = world.tools?.[tool.name];
          const record = (output: unknown, error: string | undefined) => {
            callId += 1;
            const id = `call-${callId}`;
            segments.push({ type: 'tool_call', id, label: tool.name, input });
            if (error === undefined) {
              segments.push({ type: 'tool_result', id, label: tool.name, output });
              toolCalls.push({ id, label: tool.name, input, output });
            } else {
              segments.push({ type: 'tool_result', id, label: tool.name, output: null, error });
              toolCalls.push({ id, label: tool.name, input, error });
            }
          };
          if (override?.error !== undefined) {
            const failure = mutation.failure?.(tool, context());
            record(null, override.error);
            if (failure === 'hide') {
              notes.push(`All set, ${tool.name.replace(/_/g, ' ')} went through.`);
              return;
            }
            // Read-only tools get one retry; a side-effecting tool none, unless the fault retries without end.
            const retries = failure === 'retry' ? 3 : tool.sideEffect ? 0 : 1;
            for (let attempt = 0; attempt < retries; attempt += 1) record(null, override.error);
            notes.push(
              `The ${tool.name.replace(/_/g, ' ')} service is not answering, so I cannot finish that step now; I can pass your request to a person.`,
            );
            return;
          }
          const output = (override?.result as Record<string, unknown> | undefined) ?? defaultOutput(tool);
          record(output, undefined);
          if (tool.sideEffect) payloads.push({ tool: tool.name, input, output });
          for (const property of tool.output) {
            facts.push({ tool: tool.name, field: property.name, value: output?.[property.name] });
          }
        };

        const enter = (target: string): void => {
          stage = target;
          const bound = spec.tools.find((tool) => tool.stage === target);
          if (bound) call(bound, defaultInput(bound));
        };

        const intent: Intent | undefined =
          intents.get(text) ??
          text
            .split('\n')
            .map((line) => intents.get(line.trim()))
            .find((found) => found !== undefined);
        let texts: string[] | undefined;
        switch (intent?.kind) {
          case 'transition': {
            const edge = spec.transitions.find((candidate) => candidate.id === intent.edge);
            if (edge && edge.from === stage) {
              const target = mutation.move?.(stage, edge.to, context()) ?? edge.to;
              enter(target);
              said = 'Thank you, noted.';
            } else {
              said = 'We are not at that step yet.';
            }
            break;
          }
          case 'deviation': {
            const override = mutation.deviation?.(intent.class, context());
            if (override) {
              if (override.stage !== undefined) {
                if (override.enter) enter(override.stage);
                else stage = override.stage;
              }
              texts = override.texts;
              said = DETOUR_TEXT[intent.class];
            } else if (intent.class === 'D2_goal_shift') {
              enter(spec.goal);
              said = DETOUR_TEXT.D2_goal_shift;
            } else {
              said = DETOUR_TEXT[intent.class];
            }
            break;
          }
          case 'data': {
            const value = spec.data.find((candidate) => candidate.id === intent.value);
            const tool = value ? tools.get(value.tool) : undefined;
            if (!value || !tool) break;
            if (value.direction === 'in' && value.invalid) {
              said = `I cannot send ${value.field} ${String(value.value)}: it is outside what ${tool.name.replace(/_/g, ' ')} accepts.`;
            } else {
              call(
                tool,
                value.direction === 'in'
                  ? { ...defaultInput(tool), [value.field]: value.value }
                  : defaultInput(tool),
              );
              said = 'Here is what I found.';
            }
            break;
          }
          case 'behaviour': {
            const behaviour = spec.behaviours.find((candidate) => candidate.id === intent.behaviour);
            const tool = behaviour?.tool ? tools.get(behaviour.tool) : undefined;
            if (tool && !tool.sideEffect) call(tool, defaultInput(tool));
            said = 'Of course.';
            break;
          }
          case 'flow': {
            if (stage === spec.start) enter(spec.goal);
            said = 'Happy to help with that.';
            break;
          }
          case 'persona':
            said = 'Welcome.';
            break;
          default:
            said = 'I did not understand that.';
        }

        const stated = mutation.facts?.(facts, context()) ?? facts;
        const factText = stated.map(
          (fact) => `${fact.tool.replace(/_/g, ' ')} says ${fact.field} is ${String(fact.value)}.`,
        );
        const question = stageOf.get(stage)?.question ?? '';
        const reply = [said.trim(), ...notes, ...factText, question].filter((part) => part !== '').join(' ');
        const replies = texts ?? mutation.reply?.(reply, context()) ?? [reply];
        for (const part of replies) segments.push({ type: 'text', text: part });
        return {
          segments,
          text: replies.join('\n'),
          toolCalls,
          runtime: { stages: [{ name: stage }] },
          cost: { usd: 0 },
          latencyMs: 0,
        };
      },
    };
  };
}
