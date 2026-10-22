import { createHash } from 'node:crypto';
import type { FetchRequest, FetchResponse, Transport } from '../sut/port';
import { truthLabel } from './labellers';

/**
 * A fake model endpoint. It answers a Haiku dense request or a Jev choice request from the hidden truth, reads
 * the numbered units out of whatever the request carries, and keeps every call so an item can count and inspect
 * them. It never reads a key and never opens a socket.
 *
 * The Jev request is one choice question per unit: `questions.u<n> = { type: 'choice', instructions, criteria }`,
 * where `criteria` maps each option (the labels of the set, then `none`) to its definition. The answer is
 * `answers.u<n>.probabilities`, a map from option to probability.
 */

export type ParsedCall = {
  arm: 'haiku' | 'jev';
  set: string;
  labels: string[];
  window: string;
  units: Array<{ n: number; text: string; mode: 'label' | 'context' | 'read' }>;
  /** The key of every question of a Jev request: u<n>, one per unit. */
  questions: string[];
  /** The Jev questions in request order, read as structure: key, unit number, type and the options in order. */
  choices: Array<{ key: string; n: number; type: string; options: string[] }>;
  body: string;
  headers: Record<string, string>;
};

export type FakeOptions = {
  /** The label of a unit text; default the planted truth. */
  truth?: (text: string) => string;
  /**
   * The probability vector of a Jev choice for (text, options): a map from every option, `none` among them, to
   * its probability. Default: 0.9 for the truth label and the rest shared evenly.
   */
  vector?: (text: string, options: string[], truth: string) => Record<string, number>;
  model?: string;
  /** Replaces the response of call number `index` (0-based) when it returns one. */
  respond?: (index: number, call: ParsedCall, base: FetchResponse) => FetchResponse | undefined;
  /** Adds blocks before the answer text of a Haiku response. */
  thinkingFirst?: string;
};

export type FakeTransport = Transport & { calls: ParsedCall[]; readonly count: number };

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

export function parseCall(request: FetchRequest): ParsedCall {
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    body = {};
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const arm: 'haiku' | 'jev' = record.questions !== undefined ? 'jev' : 'haiku';
  const all = strings(arm === 'jev' ? record.state : record.messages);
  const text = all.join('\n');
  const units: ParsedCall['units'] = [];
  for (const line of text.split('\n')) {
    const m = /^\[(\d+)\] (?:\((context|read)\) )?(.*)$/.exec(line);
    if (m)
      units.push({
        n: Number(m[1]),
        text: m[3] as string,
        mode: (m[2] as 'context' | 'read' | undefined) ?? 'label',
      });
  }
  const asked = (arm === 'jev' ? (record.questions ?? {}) : {}) as Record<string, unknown>;
  const questions = Object.keys(asked);
  const choices = questions.map((key) => {
    const question = (asked[key] ?? {}) as { type?: unknown; criteria?: unknown };
    const criteria = question.criteria && typeof question.criteria === 'object' ? question.criteria : {};
    return {
      key,
      n: Number(/^u(\d+)$/.exec(key)?.[1] ?? 0),
      type: typeof question.type === 'string' ? question.type : '',
      options: Object.keys(criteria),
    };
  });
  if (arm === 'jev' && units.length === 0 && questions.length > 0) {
    const n = Number(/^u(\d+)$/.exec(questions[0] as string)?.[1] ?? 1);
    const longest = [...all].sort((a, b) => b.length - a.length)[0] ?? '';
    units.push({ n, text: longest, mode: 'label' });
  }
  const labelsLine = /^LABELS (.*)$/m.exec(text)?.[1];
  const fromLine = labelsLine
    ? labelsLine
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s !== 'none' && s !== '')
    : [...text.matchAll(/^- ([a-z][a-z0-9_-]*):/gm)].map((m) => m[1] as string).filter((n) => n !== 'none');
  const labels = arm === 'jev' ? (choices[0]?.options ?? []).filter((o) => o !== 'none') : fromLine;
  return {
    arm,
    set:
      /^SET ([^:\n]+)(?::|$)/m.exec(text)?.[1]?.trim() ??
      (typeof (record.state as { set?: unknown })?.set === 'string'
        ? (record.state as { set: string }).set
        : ''),
    labels,
    window: /^WINDOW (\S+)/m.exec(text)?.[1] ?? '',
    units,
    questions,
    choices,
    body: request.body,
    headers: request.headers,
  };
}

export function fakeTransport(options: FakeOptions = {}): FakeTransport {
  const baseTruth = options.truth ?? ((text: string) => truthLabel(text));
  /** The truth label made valid for the set of the request: a label outside the set is mapped into it. */
  const truthFor =
    (call: ParsedCall) =>
    (text: string): string => {
      const want = baseTruth(text);
      if (want === 'none' || call.labels.length === 0 || call.labels.includes(want)) return want;
      const plain = call.labels.filter((l) => l !== 'gate');
      const digest = createHash('sha256').update(text).digest();
      return plain[(digest[0] as number) % plain.length] as string;
    };
  const vector =
    options.vector ??
    ((_text: string, all: string[], want: string): Record<string, number> => {
      const rest = Math.round((0.1 / Math.max(1, all.length - 1)) * 1e4) / 1e4;
      return Object.fromEntries(all.map((o) => [o, o === want ? 0.9 : rest]));
    });
  const calls: ParsedCall[] = [];
  const transport = (async (request: FetchRequest): Promise<FetchResponse> => {
    const call = parseCall(request);
    const index = calls.length;
    calls.push(call);
    let base: FetchResponse;
    if (call.arm === 'jev') {
      const answers: Record<string, { probabilities: Record<string, number> }> = {};
      const text = new Map(call.units.map((u) => [u.n, u.text]));
      const truth = truthFor(call);
      for (const choice of call.choices) {
        const unitText = text.get(choice.n) ?? '';
        answers[choice.key] = { probabilities: vector(unitText, choice.options, truth(unitText)) };
      }
      base = { status: 200, body: JSON.stringify({ model: options.model ?? 'jev-fake-1', answers }) };
    } else {
      const grouped: Array<{ units: string; label: string }> = [];
      const truth = truthFor(call);
      for (const u of call.units)
        if (u.mode === 'label') grouped.push({ units: String(u.n), label: truth(u.text) });
      const answer = JSON.stringify({ window: call.window, set: call.set, labels: grouped });
      const content: unknown[] = [];
      if (options.thinkingFirst) content.push({ type: 'thinking', thinking: options.thinkingFirst });
      content.push({ type: 'text', text: answer });
      base = {
        status: 200,
        body: JSON.stringify({
          id: `msg_fake_${index}`,
          type: 'message',
          model: options.model ?? 'claude-haiku-5-5',
          content,
          stop_reason: 'end_turn',
          usage: { input_tokens: 100 + call.units.length * 8, output_tokens: 20 + call.units.length * 6 },
        }),
      };
    }
    return options.respond?.(index, call, base) ?? base;
  }) as FakeTransport;
  Object.defineProperty(transport, 'calls', { value: calls });
  Object.defineProperty(transport, 'count', { get: () => calls.length });
  return transport;
}

/** A Haiku response with a given stop reason and answer text. */
export function haikuResponse(text: string, stop = 'end_turn', model = 'claude-haiku-5-5'): FetchResponse {
  return {
    status: 200,
    body: JSON.stringify({
      type: 'message',
      model,
      content: [{ type: 'text', text }],
      stop_reason: stop,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  };
}

export const TOO_LARGE: FetchResponse = {
  status: 400,
  body: JSON.stringify({ error: { type: 'max_tokens_exceeded', message: 'max_tokens_exceeded' } }),
};
