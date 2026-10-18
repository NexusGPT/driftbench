import type { Cost, Segment, ToolCall } from '@agent-nexus/driftbench-core';
import { isRecord, joinText, parseArguments, parseObserved } from '../shared';
import { type PriceTable, priced, type Trace, type TraceObservation, type TraceTurn } from './types';

/**
 * OpenTelemetry traces of an LLM application, read from OTLP JSON (the file exporter's format, or a
 * collector's JSON export) into driftbench traces. It reads the GenAI semantic conventions in the two shapes
 * SDKs write today:
 *
 * - the current conventions: `gen_ai.operation.name` chat or execute_tool, the messages as JSON in
 *   `gen_ai.input.messages` and `gen_ai.output.messages`, tool calls in `execute_tool` spans with
 *   `gen_ai.tool.call.id`, `.arguments` and `.result`, tokens in `gen_ai.usage.input_tokens` and
 *   `output_tokens`;
 * - flat indexed attributes: `gen_ai.prompt.N.role` and `.content`, `gen_ai.completion.N.content` and
 *   `.tool_calls.M.name`, `.arguments`, `.id`, tokens in `gen_ai.usage.prompt_tokens` and
 *   `completion_tokens`, tool spans marked `traceloop.span.kind` tool with their entity input and output.
 *
 * The span events of the earlier conventions (`gen_ai.user.message`, `gen_ai.choice`) are read too.
 *
 * Spans join into one conversation by `gen_ai.conversation.id`, else a session id, else their trace id. A
 * chat span whose input holds one more user message than the last one opens a turn; the other spans of the
 * conversation (tool calls, the agent's own span) join the turn of their trace and time. The conventions
 * have no cost attribute: `gen_ai.usage.cost` is read when an SDK writes it, else a price table gives one.
 */

export type OtelSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Milliseconds since the epoch. */
  start: number;
  end: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes: Record<string, unknown> }>;
  status?: { code: number; message?: string };
};

/** The value of an OTLP AnyValue: string, int (sent as a string or a number), double, bool, array, kvlist. */
export function anyValue(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('boolValue' in value) return value.boolValue;
  if ('bytesValue' in value) return value.bytesValue;
  if (isRecord(value.arrayValue)) {
    return (Array.isArray(value.arrayValue.values) ? value.arrayValue.values : []).map(anyValue);
  }
  if (isRecord(value.kvlistValue)) return attributesOf(value.kvlistValue.values);
  return undefined;
}

function attributesOf(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of Array.isArray(list) ? list : []) {
    if (isRecord(entry) && typeof entry.key === 'string') out[entry.key] = anyValue(entry.value);
  }
  return out;
}

/**
 * The spans of OTLP JSON text: one document (`{"resourceSpans": [...]}`), or JSON Lines of documents as
 * the OpenTelemetry file exporter writes them. A line that is not JSON is named in `issues`.
 */
export function parseOtlp(text: string): { spans: OtelSpan[]; issues: string[] } {
  const spans: OtelSpan[] = [];
  const issues: string[] = [];
  const take = (doc: unknown) => {
    if (!isRecord(doc)) return;
    for (const resource of Array.isArray(doc.resourceSpans) ? doc.resourceSpans : []) {
      if (!isRecord(resource)) continue;
      const scopes = resource.scopeSpans ?? resource.instrumentationLibrarySpans;
      for (const scope of Array.isArray(scopes) ? scopes : []) {
        if (!isRecord(scope)) continue;
        for (const raw of Array.isArray(scope.spans) ? scope.spans : []) {
          const span = spanOf(raw);
          if (span) spans.push(span);
        }
      }
    }
  };
  try {
    take(JSON.parse(text));
    return { spans, issues };
  } catch {
    // Not one document: JSON Lines.
  }
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      take(JSON.parse(line));
    } catch {
      issues.push(`line ${index + 1}: not JSON`);
    }
  });
  return { spans, issues };
}

function spanOf(raw: unknown): OtelSpan | undefined {
  if (!isRecord(raw) || typeof raw.traceId !== 'string' || typeof raw.spanId !== 'string') return undefined;
  const status =
    isRecord(raw.status) && raw.status.code !== undefined
      ? {
          code: Number(raw.status.code === 'STATUS_CODE_ERROR' ? 2 : raw.status.code),
          ...(typeof raw.status.message === 'string' ? { message: raw.status.message } : {}),
        }
      : undefined;
  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    ...(typeof raw.parentSpanId === 'string' && raw.parentSpanId !== ''
      ? { parentSpanId: raw.parentSpanId }
      : {}),
    name: typeof raw.name === 'string' ? raw.name : '',
    start: nanosToMs(raw.startTimeUnixNano),
    end: nanosToMs(raw.endTimeUnixNano ?? raw.startTimeUnixNano),
    attributes: attributesOf(raw.attributes),
    events: (Array.isArray(raw.events) ? raw.events : []).flatMap((event) =>
      isRecord(event) && typeof event.name === 'string'
        ? [{ name: event.name, attributes: attributesOf(event.attributes) }]
        : [],
    ),
    ...(status ? { status } : {}),
  };
}

type Message = {
  role: string;
  text: string;
  calls: Array<{ id?: string; name: string; input: unknown }>;
  results: Array<{ id?: string; output: unknown }>;
};

const CHAT_OPERATIONS = new Set(['chat', 'text_completion', 'generate_content', 'completion']);
const CONVERSATION_KEYS = [
  'gen_ai.conversation.id',
  'traceloop.association.properties.session_id',
  'session.id',
  'traceloop.association.properties.conversation_id',
];

function isChat(span: OtelSpan): boolean {
  const operation = span.attributes['gen_ai.operation.name'];
  if (typeof operation === 'string') return CHAT_OPERATIONS.has(operation);
  const request = span.attributes['llm.request.type'];
  if (typeof request === 'string') return CHAT_OPERATIONS.has(request);
  return 'gen_ai.input.messages' in span.attributes || 'gen_ai.prompt.0.role' in span.attributes;
}

function isTool(span: OtelSpan): boolean {
  return (
    span.attributes['gen_ai.operation.name'] === 'execute_tool' ||
    span.attributes['traceloop.span.kind'] === 'tool'
  );
}

/** The messages a chat span sent, in every shape it may carry them. */
function inputOf(span: OtelSpan): Message[] {
  const structured = jsonOf(span.attributes['gen_ai.input.messages']);
  if (Array.isArray(structured)) return structured.flatMap(messageOfParts);
  const flat: Message[] = [];
  for (let index = 0; `gen_ai.prompt.${index}.role` in span.attributes; index += 1) {
    const role = String(span.attributes[`gen_ai.prompt.${index}.role`]);
    const content = stringOf(span.attributes[`gen_ai.prompt.${index}.content`]);
    const id = span.attributes[`gen_ai.prompt.${index}.tool_call_id`];
    flat.push(
      role === 'tool'
        ? {
            role,
            text: '',
            calls: [],
            results: [{ ...(typeof id === 'string' ? { id } : {}), output: parsed(content) }],
          }
        : { role, text: content, calls: [], results: [] },
    );
  }
  if (flat.length > 0) return flat;
  return span.events.flatMap((event) => {
    const role = /^gen_ai\.(user|system|assistant|tool)\.message$/.exec(event.name)?.[1];
    if (role === undefined) return [];
    const content = stringOf(event.attributes.content);
    return [
      role === 'tool'
        ? {
            role,
            text: '',
            calls: [],
            results: [
              {
                ...(typeof event.attributes.id === 'string' ? { id: event.attributes.id } : {}),
                output: parsed(content),
              },
            ],
          }
        : { role, text: content, calls: [], results: [] },
    ];
  });
}

/** What a chat span answered: its text and the tool calls it asked for. */
function outputOf(span: OtelSpan): Message {
  const structured = jsonOf(span.attributes['gen_ai.output.messages']);
  if (Array.isArray(structured)) {
    const messages = structured.flatMap(messageOfParts);
    return {
      role: 'assistant',
      text: messages
        .map((message) => message.text)
        .filter(Boolean)
        .join('\n'),
      calls: messages.flatMap((message) => message.calls),
      results: [],
    };
  }
  if ('gen_ai.completion.0.role' in span.attributes || 'gen_ai.completion.0.content' in span.attributes) {
    const calls: Message['calls'] = [];
    for (let index = 0; `gen_ai.completion.0.tool_calls.${index}.name` in span.attributes; index += 1) {
      const prefix = `gen_ai.completion.0.tool_calls.${index}`;
      const id = span.attributes[`${prefix}.id`];
      calls.push({
        ...(typeof id === 'string' ? { id } : {}),
        name: String(span.attributes[`${prefix}.name`]),
        input: parseArguments(span.attributes[`${prefix}.arguments`]),
      });
    }
    return {
      role: 'assistant',
      text: stringOf(span.attributes['gen_ai.completion.0.content']),
      calls,
      results: [],
    };
  }
  for (const event of span.events) {
    if (event.name !== 'gen_ai.choice') continue;
    const message = jsonOf(event.attributes.message);
    if (isRecord(message)) {
      const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).flatMap((call) =>
        isRecord(call) && isRecord(call.function) && typeof call.function.name === 'string'
          ? [
              {
                ...(typeof call.id === 'string' ? { id: call.id } : {}),
                name: call.function.name,
                input: parseArguments(call.function.arguments),
              },
            ]
          : [],
      );
      return { role: 'assistant', text: stringOf(message.content), calls, results: [] };
    }
    return { role: 'assistant', text: stringOf(event.attributes.content), calls: [], results: [] };
  }
  return { role: 'assistant', text: '', calls: [], results: [] };
}

/** One message of the current conventions: a role and typed parts. */
function messageOfParts(raw: unknown): Message[] {
  if (!isRecord(raw) || typeof raw.role !== 'string') return [];
  const message: Message = { role: raw.role, text: '', calls: [], results: [] };
  const texts: string[] = [];
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  if (typeof raw.content === 'string') texts.push(raw.content);
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === 'text' && typeof part.content === 'string') texts.push(part.content);
    if (part.type === 'tool_call' && typeof part.name === 'string') {
      message.calls.push({
        ...(typeof part.id === 'string' ? { id: part.id } : {}),
        name: part.name,
        input: parseArguments(part.arguments),
      });
    }
    if (part.type === 'tool_call_response') {
      message.results.push({
        ...(typeof part.id === 'string' ? { id: part.id } : {}),
        output: part.response ?? null,
      });
    }
  }
  message.text = texts.join('\n');
  return [message];
}

type Turn = { user: string; users: number; chats: OtelSpan[]; others: OtelSpan[]; traceIds: Set<string> };

/**
 * Groups spans into conversations and turns. A conversation with no chat span gives no trace; it is named
 * in `issues`.
 */
export function tracesFromOtel(
  spans: readonly OtelSpan[],
  options: { prices?: PriceTable } = {},
): { traces: Trace[]; issues: string[] } {
  const keyOfTrace = new Map<string, string>();
  for (const span of spans) {
    for (const key of CONVERSATION_KEYS) {
      const value = span.attributes[key];
      if (typeof value === 'string' && value !== '' && !keyOfTrace.has(span.traceId))
        keyOfTrace.set(span.traceId, value);
    }
  }
  const groups = new Map<string, OtelSpan[]>();
  for (const span of spans) {
    const key = keyOfTrace.get(span.traceId) ?? span.traceId;
    groups.set(key, [...(groups.get(key) ?? []), span]);
  }

  const traces: Trace[] = [];
  const issues: string[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => a.start - b.start || a.end - b.end);
    const chats = ordered.filter(isChat);
    if (chats.length === 0) {
      issues.push(
        `${key}: ${group.length} ${group.length === 1 ? 'span' : 'spans'} and no chat span, left out`,
      );
      continue;
    }
    const turns: Turn[] = [];
    for (const chat of chats) {
      const users = inputOf(chat).filter((message) => message.role === 'user');
      const user = users.at(-1)?.text ?? '';
      const current = turns.at(-1);
      if (current === undefined || users.length !== current.users || user !== current.user) {
        turns.push({
          user,
          users: users.length,
          chats: [chat],
          others: [],
          traceIds: new Set([chat.traceId]),
        });
      } else {
        current.chats.push(chat);
        current.traceIds.add(chat.traceId);
      }
    }
    for (const span of ordered) {
      if (isChat(span)) continue;
      const sameTrace = turns.filter((turn) => turn.traceIds.has(span.traceId));
      const candidates = sameTrace.length > 0 ? sameTrace : turns;
      const owner =
        [...candidates].reverse().find((turn) => (turn.chats[0] as OtelSpan).start <= span.start) ??
        candidates[0];
      owner?.others.push(span);
    }
    const observations = ordered.map((span): TraceObservation => {
      const chat = isChat(span);
      const inputTokens = chat
        ? (numberAttr(span, 'gen_ai.usage.input_tokens') ?? numberAttr(span, 'gen_ai.usage.prompt_tokens'))
        : undefined;
      const outputTokens = chat
        ? (numberAttr(span, 'gen_ai.usage.output_tokens') ??
          numberAttr(span, 'gen_ai.usage.completion_tokens'))
        : undefined;
      const model = stringAttr(span, 'gen_ai.response.model') ?? stringAttr(span, 'gen_ai.request.model');
      const usd = chat
        ? (numberAttr(span, 'gen_ai.usage.cost') ??
          (inputTokens === undefined
            ? undefined
            : priced(options.prices, model, inputTokens, outputTokens ?? 0)))
        : undefined;
      return {
        id: span.spanId,
        ...(span.parentSpanId === undefined ? {} : { parentId: span.parentSpanId }),
        kind: chat ? 'chat' : isTool(span) ? 'tool' : 'other',
        name: span.name,
        start: new Date(span.start).toISOString(),
        end: new Date(span.end).toISOString(),
        level: span.status?.code === 2 ? 'error' : 'default',
        ...(inputTokens === undefined && outputTokens === undefined
          ? {}
          : {
              usage: {
                ...(inputTokens === undefined ? {} : { inputTokens }),
                ...(outputTokens === undefined ? {} : { outputTokens }),
              },
            }),
        ...(usd === undefined ? {} : { usd }),
        ...ioOf(span, chat),
      };
    });
    traces.push({ ...traceOf(key, turns, options.prices), observations });
  }
  traces.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id));
  return { traces, issues };
}

function traceOf(id: string, turns: Turn[], prices: PriceTable | undefined): Trace {
  const firstChat = turns[0]?.chats[0];
  const model =
    stringAttr(firstChat, 'gen_ai.response.model') ?? stringAttr(firstChat, 'gen_ai.request.model');
  const issues: string[] = [];
  const out: TraceTurn[] = turns.map((turn) => {
    const all = [...turn.chats, ...turn.others];
    const start = Math.min(...all.map((span) => span.start));
    const end = Math.max(...all.map((span) => span.end));
    const toolSpans = turn.others.filter(isTool).sort((a, b) => a.start - b.start);
    const claimed = new Set<OtelSpan>();
    const laterResults = new Map<string, unknown>();
    for (const chat of turn.chats) {
      for (const message of inputOf(chat)) {
        for (const result of message.results)
          if (result.id !== undefined) laterResults.set(result.id, result.output);
      }
    }

    type Event = { at: number; segments: Segment[]; calls: ToolCall[] };
    const events: Event[] = [];
    for (const chat of turn.chats) {
      const reply = outputOf(chat);
      const segments: Segment[] = [];
      const calls: ToolCall[] = [];
      if (reply.text !== '') segments.push({ type: 'text', text: reply.text });
      for (const call of reply.calls) {
        const span =
          toolSpans.find(
            (candidate) =>
              !claimed.has(candidate) && call.id !== undefined && toolCallId(candidate) === call.id,
          ) ??
          toolSpans.find(
            (candidate) =>
              !claimed.has(candidate) &&
              toolName(candidate) === call.name &&
              toolCallId(candidate) === undefined,
          );
        if (span) claimed.add(span);
        const record = toolRecord(call.name, call.input, span, call.id);
        if (span === undefined && call.id !== undefined && laterResults.has(call.id)) {
          record.output = laterResults.get(call.id);
        }
        if (span === undefined && record.output === undefined && record.error === undefined) {
          issues.push(`turn ${turns.indexOf(turn) + 1}: no result for the call to ${call.name}`);
        }
        segments.push({
          type: 'tool_call',
          ...(call.id ? { id: call.id } : {}),
          label: call.name,
          input: call.input,
        });
        segments.push({
          type: 'tool_result',
          ...(call.id ? { id: call.id } : {}),
          label: call.name,
          output: record.output ?? null,
          ...(record.error !== undefined ? { error: record.error } : {}),
        });
        calls.push(record);
      }
      events.push({ at: chat.end, segments, calls });
    }
    for (const span of toolSpans) {
      if (claimed.has(span)) continue;
      const name = toolName(span) ?? span.name;
      const record = toolRecord(name, parseArguments(toolArguments(span)), span, toolCallId(span));
      events.push({
        at: span.start,
        segments: [
          { type: 'tool_call', ...(record.id ? { id: record.id } : {}), label: name, input: record.input },
          {
            type: 'tool_result',
            ...(record.id ? { id: record.id } : {}),
            label: name,
            output: record.output ?? null,
            ...(record.error !== undefined ? { error: record.error } : {}),
          },
        ],
        calls: [record],
      });
    }
    events.sort((a, b) => a.at - b.at);
    const segments = events.flatMap((event) => event.segments);

    const tokens = { input: 0, output: 0, counted: false };
    let usd = 0;
    let everyPriced = true;
    for (const chat of turn.chats) {
      const input =
        numberAttr(chat, 'gen_ai.usage.input_tokens') ?? numberAttr(chat, 'gen_ai.usage.prompt_tokens');
      const output =
        numberAttr(chat, 'gen_ai.usage.output_tokens') ?? numberAttr(chat, 'gen_ai.usage.completion_tokens');
      if (input !== undefined || output !== undefined) tokens.counted = true;
      tokens.input += input ?? 0;
      tokens.output += output ?? 0;
      const spanModel = stringAttr(chat, 'gen_ai.response.model') ?? stringAttr(chat, 'gen_ai.request.model');
      const cost =
        numberAttr(chat, 'gen_ai.usage.cost') ?? priced(prices, spanModel, input ?? 0, output ?? 0);
      if (cost === undefined) everyPriced = false;
      else usd += cost;
    }
    const cost: Cost = {};
    if (everyPriced) cost.usd = Math.round(usd * 1e9) / 1e9;
    if (tokens.counted) {
      cost.inputTokens = tokens.input;
      cost.outputTokens = tokens.output;
    }
    return {
      user: turn.user,
      startedAt: iso(start),
      ...(turn.chats[0] ? { observationId: turn.chats[0].spanId } : {}),
      observed: parseObserved(
        {
          segments,
          text: joinText(segments),
          toolCalls: events.flatMap((event) => event.calls),
          cost,
          latencyMs: round(end - start),
        },
        'the OpenTelemetry reader',
      ),
    };
  });
  return {
    id,
    source: 'otel',
    ...(out[0]?.startedAt ? { startedAt: out[0].startedAt } : {}),
    ...(model ? { model } : {}),
    turns: out,
    issues,
  };
}

function toolRecord(
  name: string,
  input: unknown,
  span: OtelSpan | undefined,
  id: string | undefined,
): ToolCall {
  const record: ToolCall = {
    ...(id !== undefined ? { id } : {}),
    ...(span === undefined ? {} : { spanId: span.spanId }),
    label: name,
    input,
  };
  if (span === undefined) return record;
  if (span.status?.code === 2)
    record.error = span.status.message || stringOf(span.attributes['error.type']) || 'error';
  else {
    const result = span.attributes['gen_ai.tool.call.result'] ?? span.attributes['traceloop.entity.output'];
    if (result !== undefined) record.output = typeof result === 'string' ? parsed(result) : result;
  }
  record.startedAt = iso(span.start);
  record.latencyMs = round(span.end - span.start);
  return record;
}

function toolName(span: OtelSpan): string | undefined {
  return stringAttr(span, 'gen_ai.tool.name') ?? stringAttr(span, 'traceloop.entity.name');
}

function toolCallId(span: OtelSpan): string | undefined {
  return stringAttr(span, 'gen_ai.tool.call.id');
}

function toolArguments(span: OtelSpan): unknown {
  return span.attributes['gen_ai.tool.call.arguments'] ?? span.attributes['traceloop.entity.input'];
}

function stringAttr(span: OtelSpan | undefined, key: string): string | undefined {
  const value = span?.attributes[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberAttr(span: OtelSpan, key: string): number | undefined {
  const value = span.attributes[key];
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined;
}

function stringOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function jsonOf(value: unknown): unknown {
  return typeof value === 'string' ? parsed(value) : value;
}

/** The JSON a string holds, else the string itself; undefined for an empty string. */
function parsed(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Nanoseconds since the epoch, as OTLP JSON writes them (a decimal string, sometimes a number), in
 * milliseconds. A whole-number string goes through BigInt: a double cannot hold today's nanoseconds exactly.
 */
function nanosToMs(raw: unknown): number {
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(BigInt(raw) / 1000n) / 1000;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value / 1e6 : 0;
}

function iso(ms: number): string {
  return new Date(Math.floor(ms)).toISOString();
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

/** A tool span's arguments and result, or a chat span's reply text, as the source wrote them. */
function ioOf(span: OtelSpan, chat: boolean): { input?: unknown; output?: unknown } {
  if (chat) {
    const text = outputOf(span).text;
    return text === '' ? {} : { output: text };
  }
  if (!isTool(span)) return {};
  const input = span.attributes['gen_ai.tool.call.arguments'] ?? span.attributes['traceloop.entity.input'];
  const result =
    span.status?.code === 2
      ? undefined
      : (span.attributes['gen_ai.tool.call.result'] ?? span.attributes['traceloop.entity.output']);
  return {
    ...(input === undefined ? {} : { input: typeof input === 'string' ? parsed(input) : input }),
    ...(result === undefined ? {} : { output: typeof result === 'string' ? parsed(result) : result }),
  };
}
