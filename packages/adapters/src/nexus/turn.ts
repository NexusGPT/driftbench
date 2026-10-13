import {
  AgentFailure,
  type Cost,
  canonicalJson,
  isPlainObject,
  type Observed,
  type Segment,
  type ToolCall,
} from '@agent-nexus/driftbench-core';
import { contentText, joinText, parseArguments, parseObserved } from '../shared';

/**
 * Reading a Nexus agent turn into an Observed, from the two places the platform keeps it.
 *
 * - `generate` answers with a candidate: the turn's tool calls with their outputs and its FINAL text only.
 *   Text the agent sent before a tool call is not in it.
 * - Tracing keeps every model call (a generation) of the turn: its reply text, the tool calls it asked for,
 *   and the tool results the next generation received, with tokens, cost and duration. That is the whole
 *   turn, so `trace` reads it from there.
 */

/** A candidate reply, as `generate` returns it. */
export type Candidate = {
  content: string;
  toolCalls: { name: string; input: unknown; output?: unknown }[];
  latencyMs?: number;
  tokensUsed?: unknown;
};

/** One generation as `GET /tracing/generations/:id` returns it; only the fields read here. */
export type Generation = {
  id: string;
  status?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  messages?: unknown;
  response?: string | null;
  responseJson?: unknown;
};

/** The card a Nexus tool call sends: send_message and display_html under their own name, a template by its name. */
export function cardOf(label: string): string | undefined {
  if (label === 'send_message' || label === 'display_html') return label;
  return /^send_html_template_(.+)$/.exec(label)?.[1];
}

/** Checks the candidate of a generate answer and keeps what the adapter reads. */
export function readCandidate(value: unknown, where: string): Candidate {
  if (!isPlainObject(value) || typeof value.content !== 'string') {
    throw new AgentFailure(`${where} answered without a candidate reply (candidate.content)`);
  }
  const toolCalls = (Array.isArray(value.toolCalls) ? value.toolCalls : []).flatMap((call: unknown) => {
    if (!isPlainObject(call) || typeof call.name !== 'string' || call.name === '') return [];
    return [
      { name: call.name, input: call.input ?? null, ...('output' in call ? { output: call.output } : {}) },
    ];
  });
  const candidate: Candidate = { content: value.content, toolCalls };
  if (typeof value.latencyMs === 'number' && value.latencyMs >= 0) candidate.latencyMs = value.latencyMs;
  if (value.tokensUsed !== undefined) candidate.tokensUsed = value.tokensUsed;
  return candidate;
}

/**
 * The view `generate` gives: each tool call with its result, then the final text. `tokensUsed` counts only
 * when it is above zero: the platform writes it asynchronously, so zero means "not recorded yet".
 */
export function observedFromCandidate(candidate: Candidate, measuredMs: number, raw: unknown): Observed {
  const segments: Segment[] = [];
  const toolCalls: ToolCall[] = [];
  for (const call of candidate.toolCalls) {
    const output = 'output' in call ? call.output : null;
    segments.push({ type: 'tool_call', label: call.name, input: call.input });
    segments.push({ type: 'tool_result', label: call.name, output });
    toolCalls.push({ label: call.name, input: call.input, output });
    pushCard(segments, call.name, call.input);
  }
  if (candidate.content !== '') segments.push({ type: 'text', text: candidate.content });
  return parseObserved(
    {
      segments,
      text: joinText(segments),
      toolCalls,
      cost: tokensOf(candidate.tokensUsed),
      latencyMs: candidate.latencyMs ?? measuredMs,
      raw,
    },
    'the nexus generate answer',
  );
}

/**
 * The whole turn from its generations, in start order. Each generation adds its reply text, then each tool
 * call it asked for followed by that call's result. A result is read from the `tool_result` a later
 * generation received; a call the turn ended on has none, so its output comes from the candidate when one is
 * given. A generation's cost, tokens and duration go on its first segment, so the segments add up to the turn.
 */
export function observedFromGenerations(
  generations: readonly Generation[],
  candidate: Candidate | undefined,
  raw: unknown,
): Observed {
  const ordered = [...generations].sort((a, b) => time(a.startedAt) - time(b.startedAt));
  const results = new Map<string, { output: unknown; error?: string }>();
  for (const generation of ordered) {
    for (const message of Array.isArray(generation.messages) ? generation.messages : []) {
      if (!isPlainObject(message) || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (isPlainObject(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          results.set(block.tool_use_id, decodeResult(block));
        }
      }
    }
  }

  const unclaimed = [...(candidate?.toolCalls ?? [])];
  const segments: Segment[] = [];
  const toolCalls: ToolCall[] = [];
  const total = { usd: 0, inputTokens: 0, outputTokens: 0, priced: false, counted: false };
  for (const generation of ordered) {
    let measure: Pick<Segment, 'cost' | 'latencyMs'> | undefined = measureOf(generation);
    const take = () => {
      const taken = measure ?? {};
      measure = undefined;
      return taken;
    };
    if (typeof generation.costUsd === 'number') {
      total.usd += generation.costUsd;
      total.priced = true;
    }
    if (isCount(generation.inputTokens) || isCount(generation.outputTokens)) {
      total.inputTokens += isCount(generation.inputTokens) ? generation.inputTokens : 0;
      total.outputTokens += isCount(generation.outputTokens) ? generation.outputTokens : 0;
      total.counted = true;
    }

    const reply = replyOf(generation);
    if (reply.text !== '') segments.push({ type: 'text', text: reply.text, ...take() });
    for (const call of reply.calls) {
      const result = results.get(call.id) ?? claim(unclaimed, call.name, call.input);
      const output = result?.output ?? null;
      const error = result?.error;
      segments.push({ type: 'tool_call', id: call.id, label: call.name, input: call.input, ...take() });
      segments.push({
        type: 'tool_result',
        id: call.id,
        label: call.name,
        output,
        ...(error === undefined ? {} : { error }),
      });
      const recorded: ToolCall = { id: call.id, label: call.name, input: call.input };
      if (error === undefined) recorded.output = output;
      else recorded.error = error;
      if (typeof generation.completedAt === 'string') recorded.startedAt = generation.completedAt;
      toolCalls.push(recorded);
      pushCard(segments, call.name, call.input);
    }
  }

  const cost: Cost = {};
  if (total.priced) cost.usd = round(total.usd);
  if (total.counted) {
    cost.inputTokens = total.inputTokens;
    cost.outputTokens = total.outputTokens;
  }
  return parseObserved(
    {
      segments,
      text: joinText(segments),
      toolCalls,
      cost,
      latencyMs: spanOf(ordered) ?? candidate?.latencyMs ?? 0,
      raw,
    },
    'the nexus trace',
  );
}

/** What one generation said: its reply text and the tool calls it asked for, in order. */
function replyOf(generation: Generation): {
  text: string;
  calls: { id: string; name: string; input: unknown }[];
} {
  const json = generation.responseJson;
  const calls: { id: string; name: string; input: unknown }[] = [];
  if (!isPlainObject(json)) {
    return { text: typeof generation.response === 'string' ? generation.response : '', calls };
  }
  // OpenAI shape: { content, tool_calls: [{ id, function: { name, arguments } }] }, as the platform stores it.
  for (const call of Array.isArray(json.tool_calls) ? json.tool_calls : []) {
    if (!isPlainObject(call) || !isPlainObject(call.function)) continue;
    if (typeof call.function.name !== 'string') continue;
    const id = typeof call.id === 'string' ? call.id : `${generation.id}-${calls.length + 1}`;
    calls.push({ id, name: call.function.name, input: parseArguments(call.function.arguments) });
  }
  // Content blocks shape: [{ type: 'text', text }, { type: 'tool_use', id, name, input }].
  if (Array.isArray(json.content)) {
    for (const block of json.content) {
      if (!isPlainObject(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      const id = typeof block.id === 'string' ? block.id : `${generation.id}-${calls.length + 1}`;
      calls.push({ id, name: block.name, input: block.input ?? null });
    }
  }
  const text = contentText(json.content);
  return {
    text: text !== '' ? text : typeof generation.response === 'string' ? generation.response : '',
    calls,
  };
}

/** A tool result block: its text, parsed as JSON when it is JSON; `is_error` makes the text the error. */
function decodeResult(block: Record<string, unknown>): { output: unknown; error?: string } {
  const text = Array.isArray(block.content)
    ? contentText(block.content)
    : typeof block.content === 'string'
      ? block.content
      : '';
  if (block.is_error === true) return { output: null, error: text };
  try {
    return { output: JSON.parse(text) };
  } catch {
    return { output: text };
  }
}

/** The first candidate call with this name and input, else with this name, taken out of the list. */
function claim(
  unclaimed: Candidate['toolCalls'],
  name: string,
  input: unknown,
): { output: unknown; error?: string } | undefined {
  let index = unclaimed.findIndex(
    (call) => call.name === name && canonicalJson(call.input) === canonicalJson(input),
  );
  if (index < 0) index = unclaimed.findIndex((call) => call.name === name);
  if (index < 0) return undefined;
  const [call] = unclaimed.splice(index, 1);
  return call && 'output' in call ? { output: call.output } : undefined;
}

function measureOf(generation: Generation): Pick<Segment, 'cost' | 'latencyMs'> {
  const cost: Cost = {};
  if (typeof generation.costUsd === 'number' && generation.costUsd >= 0) cost.usd = generation.costUsd;
  if (isCount(generation.inputTokens)) cost.inputTokens = generation.inputTokens;
  if (isCount(generation.outputTokens)) cost.outputTokens = generation.outputTokens;
  return {
    ...(Object.keys(cost).length > 0 ? { cost } : {}),
    ...(typeof generation.durationMs === 'number' && generation.durationMs >= 0
      ? { latencyMs: generation.durationMs }
      : {}),
  };
}

function pushCard(segments: Segment[], label: string, input: unknown): void {
  const name = cardOf(label);
  if (name !== undefined) segments.push({ type: 'card', name, data: input });
}

/** Tokens from `{ input, output }` when the platform recorded any. */
function tokensOf(tokensUsed: unknown): Cost {
  if (!isPlainObject(tokensUsed)) return {};
  const input = tokensUsed.input;
  const output = tokensUsed.output;
  if (!isCount(input) || !isCount(output) || input + output === 0) return {};
  return { inputTokens: input, outputTokens: output };
}

/** Milliseconds from the first generation's start to the last one's end, tool runs included. */
function spanOf(generations: readonly Generation[]): number | undefined {
  const starts = generations.map((generation) => time(generation.startedAt)).filter(Number.isFinite);
  const ends = generations.map((generation) => time(generation.completedAt)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return undefined;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

function time(value: string | null | undefined): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
