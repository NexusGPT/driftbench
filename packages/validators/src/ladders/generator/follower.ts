import { createHash } from 'node:crypto';
import type {
  ArtifactRef,
  DeviationClass,
  Message,
  Observed,
  Segment,
  ToolCall,
  WorkspaceDiff,
  WorldState,
} from '@agent-nexus/driftbench-core';
import type { FaultSession } from '@agent-nexus/driftbench-generate';
import { DETOUR_TEXT, type HiddenProperty, type HiddenSpec, type HiddenTool, readTurn } from './hidden';

/**
 * The rule follower: an agent built by code from the hidden specification that follows it exactly. It reads
 * each user turn through the phrase bank (a phrase's `{slot}` is read back from the turn and remembered),
 * takes a move only from the stage it leaves, calls the tool bound to the stage it enters with the slot
 * values the conversation gave, stays where it was when that tool fails after its one retry, keeps to its
 * step through a detour and says the words the recovery names, goes back to the goal stage on a goal shift,
 * replies once in English with the pending question, never calls the side-effecting tool before CONFIRM,
 * writes the export file when asked, and reports its stage on every turn.
 *
 * A mutation replaces decisions with wrong ones. Every hook is a transformer: it receives the follower's
 * decision and returns the decision to take, so two mutations compose by applying one after the other
 * (faults.ts plants single faults and their pairwise and three-way combinations). No model.
 */

/** A fact the reply states: what a tool answered. */
export type Fact = { tool: string; field: string; value: unknown };

/** What a mutation sees: the specification, the current stage, the opportunity counter. */
export type MutationContext = {
  spec: HiddenSpec;
  stage: string;
  /** Counts one opportunity of `key` in this conversation and returns its number, from 1. */
  opportunity(key: string): number;
};

/** The rule's answer to a deviation: where the conversation stays and what is said. */
export type DeviationAnswer = {
  stage: string;
  enter: boolean;
  said: string;
  /** The whole reply, as segments, in place of the composed one. */
  replies?: string[];
};

/** A workspace change the save behaviour makes. */
export type SaveResult = {
  diff: WorkspaceDiff;
  artifacts: ArtifactRef[];
  said: string;
  files: Record<string, string>;
};
export type FileSession = FaultSession & { files(): Record<string, string> };

/** Wrong decisions. Each hook gets the rule's decision and returns the one to take. */
export type Mutation = {
  move?(from: string, to: string, ctx: MutationContext): string;
  deviation?(cls: DeviationClass, answer: DeviationAnswer, ctx: MutationContext): DeviationAnswer;
  input?(tool: HiddenTool, input: Record<string, unknown>, ctx: MutationContext): Record<string, unknown>;
  /** How many times the tool is called: 1 by the rule, 0 drops the call. */
  calls?(tool: HiddenTool, count: number, ctx: MutationContext): number;
  /** Tools called on top of the turn's own calls. */
  extra?(called: string[], ctx: MutationContext): string[];
  facts?(facts: Fact[], ctx: MutationContext, called: readonly string[]): Fact[];
  reply?(texts: string[], ctx: MutationContext): string[];
  /** On a failing tool: the rule retries a read-only tool once and stays. */
  failure?(
    tool: HiddenTool,
    rule: 'retry' | 'stop',
    ctx: MutationContext,
  ): 'retry' | 'stop' | 'hide' | 'retry-many' | 'advance';
  /** The stage the runtime reports; null reports none. */
  report?(stage: string, ctx: MutationContext): string | null;
  /** The value a slot keeps when the user states it. */
  slot?(name: string, given: string, held: string | undefined, ctx: MutationContext): string;
  save?(result: SaveResult, ctx: MutationContext): SaveResult;
};

/** Applies mutations one after the other: the second sees the first one's decision. */
export function compose(...mutations: Mutation[]): Mutation {
  const chain = <K extends keyof Mutation>(key: K) =>
    mutations.filter((mutation) => mutation[key] !== undefined);
  return {
    move: (from, to, ctx) =>
      chain('move').reduce((target, mutation) => mutation.move?.(from, target, ctx) ?? target, to),
    deviation: (cls, answer, ctx) =>
      chain('deviation').reduce(
        (current, mutation) => mutation.deviation?.(cls, current, ctx) ?? current,
        answer,
      ),
    input: (tool, input, ctx) =>
      chain('input').reduce((current, mutation) => mutation.input?.(tool, current, ctx) ?? current, input),
    calls: (tool, count, ctx) =>
      chain('calls').reduce((current, mutation) => mutation.calls?.(tool, current, ctx) ?? current, count),
    extra: (called, ctx) => chain('extra').flatMap((mutation) => mutation.extra?.(called, ctx) ?? []),
    facts: (facts, ctx, called) =>
      chain('facts').reduce((current, mutation) => mutation.facts?.(current, ctx, called) ?? current, facts),
    reply: (texts, ctx) =>
      chain('reply').reduce((current, mutation) => mutation.reply?.(current, ctx) ?? current, texts),
    failure: (tool, rule, ctx) =>
      chain('failure').reduce<ReturnType<NonNullable<Mutation['failure']>>>(
        (current, mutation) =>
          current === 'retry' || current === 'stop'
            ? (mutation.failure?.(tool, current, ctx) ?? current)
            : current,
        rule,
      ),
    report: (stage, ctx) =>
      chain('report').reduce<string | null>(
        (current, mutation) =>
          current === null || mutation.report === undefined ? current : mutation.report(current, ctx),
        stage,
      ),
    slot: (name, given, held, ctx) =>
      chain('slot').reduce(
        (current, mutation) => mutation.slot?.(name, current, held, ctx) ?? current,
        given,
      ),
    save: (result, ctx) =>
      chain('save').reduce((current, mutation) => mutation.save?.(current, ctx) ?? current, result),
  };
}

/** A reply in another language, long enough for the language check to judge it. */
export const FOREIGN_REPLY = 'Ik help u graag verder met uw aanvraag, maar ik antwoord nu in het Nederlands.';

/** The first valid value of a property: the input the follower sends when the conversation names none. */
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

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The content the save behaviour writes. */
export function savedContent(spec: HiddenSpec): string {
  return `${JSON.stringify({ agent: spec.agent, saved: true })}\n`;
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
export function createFollower(spec: HiddenSpec, mutation: Mutation = {}): () => FileSession {
  const tools = new Map(spec.tools.map((tool) => [tool.name, tool]));
  const stageOf = new Map(spec.stages.map((stage) => [stage.id, stage]));
  const instructions = spec.phrases
    .filter(
      (phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === 'D6_instruction_in_data',
    )
    .map((phrase) => phrase.text);
  const carriesInstruction = (value: unknown): boolean => {
    if (typeof value === 'string') return instructions.some((instruction) => value.includes(instruction));
    if (Array.isArray(value)) return value.some(carriesInstruction);
    if (value !== null && typeof value === 'object') return Object.values(value).some(carriesInstruction);
    return false;
  };
  return () => {
    let stage = spec.start;
    const memory: Record<string, string> = {};
    const payloads: { tool: string; input: unknown; output?: unknown }[] = [];
    const counts = new Map<string, number>();
    const ctx = (): MutationContext => ({
      spec,
      stage,
      opportunity(key) {
        const seen = (counts.get(key) ?? 0) + 1;
        counts.set(key, seen);
        return seen;
      },
    });
    let initialized = false;
    let activeMutation = mutation;
    let files: Record<string, string> = {};
    const session: FileSession = {
      files: () => ({ ...files }),
      payloads: () => payloads,
      async respond(messages: Message[], world: WorldState): Promise<Observed> {
        if (!initialized) {
          initialized = true;
          files = { ...(world.workspace?.files ?? {}) };
          // A fresh teacher-forced session receives completed turns before its current turn.
          // Replay those turns under the reference rules, using each recorded tool response.
          // Historical actions establish state; they are not new actions or mutation opportunities.
          activeMutation = {};
          try {
            const prefix: Message[] = [];
            for (const message of messages) {
              if (message.role === 'assistant' && prefix.at(-1)?.role === 'user') {
                const priorTools: NonNullable<WorldState['tools']> = {};
                for (const call of message.tool_calls ?? []) {
                  priorTools[call.label] =
                    call.error !== undefined
                      ? { error: call.error }
                      : call.output !== undefined
                        ? { result: call.output }
                        : {};
                }
                await session.respond(prefix, { tools: priorTools });
              }
              prefix.push(message);
            }
          } finally {
            activeMutation = mutation;
            payloads.length = 0;
          }
        }
        const text = userTurn(messages).trim();
        const segments: Segment[] = [];
        const toolCalls: ToolCall[] = [];
        const facts: Fact[] = [];
        const notes: string[] = [];
        let said = '';
        let replaced: string[] | undefined;
        let callId = 0;
        let dataInstruction = carriesInstruction(world.workspace?.files);
        let workspace: WorkspaceDiff | undefined = world.workspace
          ? { created: [], changed: [], deleted: [] }
          : undefined;
        let artifacts: ArtifactRef[] | undefined;

        const record = (tool: string, input: unknown, output: unknown, error: string | undefined) => {
          callId += 1;
          const id = `call-${callId}`;
          segments.push({ type: 'tool_call', id, label: tool, input });
          if (error === undefined) {
            dataInstruction ||= carriesInstruction(output);
            segments.push({ type: 'tool_result', id, label: tool, output });
            toolCalls.push({ id, label: tool, input, output });
          } else {
            segments.push({ type: 'tool_result', id, label: tool, output: null, error });
            toolCalls.push({ id, label: tool, input, error });
          }
        };

        /** Calls a tool as the turn needs; false when it failed and the step cannot be taken. */
        const call = (tool: HiddenTool, stated: Record<string, unknown> = {}): boolean => {
          const wanted: Record<string, unknown> = { ...defaultInput(tool) };
          const field = tool.input[0]?.name;
          if (field !== undefined && memory[tool.slot] !== undefined) wanted[field] = memory[tool.slot];
          Object.assign(wanted, stated);
          const input = activeMutation.input?.(tool, wanted, ctx()) ?? wanted;
          const times = activeMutation.calls?.(tool, 1, ctx()) ?? 1;
          if (times === 0) {
            facts.push(
              ...tool.output.map((property) => ({
                tool: tool.name,
                field: property.name,
                value: defaultValue(property),
              })),
            );
            return true;
          }
          const override = world.tools?.[tool.name];
          if (override?.error !== undefined) {
            const rule = tool.sideEffect ? 'stop' : 'retry';
            const choice = activeMutation.failure?.(tool, rule, ctx()) ?? rule;
            const attempts = choice === 'retry' ? 2 : choice === 'retry-many' ? 4 : 1;
            for (let attempt = 0; attempt < attempts; attempt += 1)
              record(tool.name, input, null, override.error);
            if (choice === 'hide') {
              notes.push(`All set, ${tool.name.replace(/_/g, ' ')} went through.`);
              return true;
            }
            notes.push(
              `The ${tool.name.replace(/_/g, ' ')} service is not answering, so I cannot finish that step now; I can pass your request to a person.`,
            );
            return choice === 'advance';
          }
          const output = (override?.result as Record<string, unknown> | undefined) ?? defaultOutput(tool);
          for (let attempt = 0; attempt < times; attempt += 1) {
            record(tool.name, input, output, undefined);
            if (tool.sideEffect) payloads.push({ tool: tool.name, input, output });
          }
          for (const property of tool.output)
            facts.push({ tool: tool.name, field: property.name, value: output?.[property.name] });
          return true;
        };

        const enter = (target: string): void => {
          const bound = spec.tools.find((tool) => tool.stage === target);
          if (bound && !call(bound)) return;
          stage = target;
        };

        const read =
          readTurn(spec, text) ??
          text
            .split('\n')
            .map((line) => readTurn(spec, line))
            .find((found) => found !== undefined);
        for (const [name, value] of Object.entries(read?.slots ?? {})) {
          memory[name] = activeMutation.slot?.(name, value, memory[name], ctx()) ?? value;
        }
        const intent = read?.intent;
        switch (intent?.kind) {
          case 'transition': {
            const edge = spec.transitions.find((candidate) => candidate.id === intent.edge);
            if (edge && edge.from === stage) {
              const target = activeMutation.move?.(stage, edge.to, ctx()) ?? edge.to;
              enter(target);
              said = 'Thank you, noted.';
            } else {
              said = 'We are not at that step yet.';
            }
            break;
          }
          case 'deviation': {
            const rule: DeviationAnswer =
              intent.class === 'D2_goal_shift'
                ? { stage: spec.goal, enter: true, said: DETOUR_TEXT.D2_goal_shift }
                : { stage, enter: false, said: DETOUR_TEXT[intent.class] };
            const answer = activeMutation.deviation?.(intent.class, rule, ctx()) ?? rule;
            if (answer.stage !== stage) {
              if (answer.enter) enter(answer.stage);
              else stage = answer.stage;
            }
            said = answer.said;
            replaced = answer.replies;
            break;
          }
          case 'data': {
            const value = spec.data.find((candidate) => candidate.id === intent.value);
            const tool = value ? tools.get(value.tool) : undefined;
            if (!value || !tool) break;
            if (value.direction === 'in' && value.invalid) {
              said = `I cannot send ${value.field} ${String(value.value)}: it is outside what ${tool.name.replace(/_/g, ' ')} accepts.`;
            } else if (tool.sideEffect) {
              said = 'I submit requests only after CONFIRM at the recap.';
            } else {
              if (value.direction === 'in' && value.field === tool.input[0]?.name)
                memory[tool.slot] = String(value.value);
              call(tool, value.direction === 'in' ? { [value.field]: value.value } : {});
              said = 'Here is what I found.';
            }
            break;
          }
          case 'save': {
            const record = files['input.json']
              ? JSON.parse(files['input.json']).records[0]
              : { agent: spec.agent };
            const content = `${JSON.stringify({ agent: record.agent, saved: true })}\n`;
            const rule: SaveResult = {
              files: { [spec.saveFile]: content },
              diff: { created: [spec.saveFile], changed: [], deleted: [] },
              artifacts: [{ path: spec.saveFile, sha256: sha256(content), bytes: content.length }],
              said: `I saved the record to ${spec.saveFile}.`,
            };
            const result = activeMutation.save?.(rule, ctx()) ?? rule;
            for (const path of result.diff.deleted) delete files[path];
            Object.assign(files, result.files);
            workspace = result.diff;
            artifacts = result.artifacts;
            said = result.said;
            break;
          }
          case 'behaviour': {
            const behaviour = spec.behaviours.find((candidate) => candidate.id === intent.behaviour);
            const tool = behaviour?.tool ? tools.get(behaviour.tool) : undefined;
            if (tool && !tool.sideEffect) call(tool);
            said = 'Of course.';
            break;
          }
          case 'flow':
            if (stage === spec.start) enter(spec.goal);
            said = 'Happy to help with that.';
            break;
          case 'persona':
            said = 'Welcome.';
            break;
          default:
            said = 'I did not understand that.';
        }

        // World-carried data is encountered during the normal turn. Keep that turn's
        // completed action and stage; only a faulty agent follows the embedded instruction.
        if (dataInstruction && !(intent?.kind === 'deviation' && intent.class === 'D6_instruction_in_data')) {
          const rule: DeviationAnswer = {
            stage,
            enter: false,
            said,
            ...(replaced ? { replies: replaced } : {}),
          };
          const answer = activeMutation.deviation?.('D6_instruction_in_data', rule, ctx()) ?? rule;
          if (answer.stage !== stage) {
            if (answer.enter) enter(answer.stage);
            else stage = answer.stage;
          }
          said = answer.said;
          replaced = answer.replies;
        }

        for (const extra of activeMutation.extra?.(
          toolCalls.map((call) => call.label),
          ctx(),
        ) ?? []) {
          const tool = tools.get(extra);
          if (tool) record(tool.name, defaultInput(tool), defaultOutput(tool), undefined);
        }
        const stated =
          activeMutation.facts?.(
            facts,
            ctx(),
            toolCalls.map((call) => call.label),
          ) ?? facts;
        const factText = stated.map(
          (fact) => `${fact.tool.replace(/_/g, ' ')} says ${fact.field} is ${String(fact.value)}.`,
        );
        const question = stageOf.get(stage)?.question ?? '';
        const reply = [said.trim(), ...notes, ...factText, question].filter((part) => part !== '').join(' ');
        const composed = replaced ?? [reply];
        const replies = activeMutation.reply?.(composed, ctx()) ?? composed;
        for (const part of replies) segments.push({ type: 'text', text: part });
        const reported = activeMutation.report ? activeMutation.report(stage, ctx()) : stage;
        return {
          segments,
          text: replies.join('\n'),
          toolCalls,
          ...(reported === null ? {} : { runtime: { stages: [{ name: reported }] } }),
          ...(workspace ? { workspaceDiff: workspace } : {}),
          ...(artifacts ? { artifacts } : {}),
          cost: { usd: 0 },
          latencyMs: 0,
        };
      },
    };
    return session;
  };
}
