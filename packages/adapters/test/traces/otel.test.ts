import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { anyValue, parseOtlp, tracesFromOtel } from '../../src/traces';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const read = (name: string) => readFile(`${FIXTURES}${name}`, 'utf8');

describe('anyValue', () => {
  it('decodes every OTLP AnyValue form', () => {
    expect(anyValue({ stringValue: 'a' })).toBe('a');
    expect(anyValue({ intValue: '42' })).toBe(42);
    expect(anyValue({ intValue: 7 })).toBe(7);
    expect(anyValue({ doubleValue: 0.5 })).toBe(0.5);
    expect(anyValue({ boolValue: true })).toBe(true);
    expect(anyValue({ arrayValue: { values: [{ stringValue: 'x' }, { intValue: '1' }] } })).toEqual(['x', 1]);
    expect(anyValue({ kvlistValue: { values: [{ key: 'k', value: { stringValue: 'v' } }] } })).toEqual({
      k: 'v',
    });
    expect(anyValue({})).toBeUndefined();
  });
});

describe('parseOtlp', () => {
  it('reads one OTLP JSON document or JSON Lines of them, and names a bad line', async () => {
    expect((await parseOtlp(await read('otel-semconv.json'))).spans).toHaveLength(6);
    expect((await parseOtlp(await read('otel-flat.jsonl'))).spans).toHaveLength(6);
    const bad = parseOtlp('{"resourceSpans": []}\nnot json\n');
    expect(bad.issues).toEqual(['line 2: not JSON']);
  });
});

describe('tracesFromOtel: the current GenAI semantic conventions', () => {
  it('maps a conversation to turns with tool calls, results, model, tokens and cost', async () => {
    const [trace, ...rest] = tracesFromOtel(parseOtlp(await read('otel-semconv.json')).spans).traces;
    expect(rest).toEqual([]);
    expect(trace).toMatchObject({
      id: 'conv-acme-0001',
      source: 'otel',
      model: 'example-model-1-0301',
      startedAt: '2026-03-02T10:00:00.000Z',
      issues: [],
    });
    const [first, second] = trace?.turns ?? [];
    expect(first?.user).toBe('Hi, do you have home internet at 3 Orchard Way, Acmeville?');
    expect(first?.observed.toolCalls).toEqual([
      {
        id: 'call_cov_1',
        spanId: 'a100000000000003',
        label: 'coverage.check',
        input: { address: '3 Orchard Way, Acmeville' },
        output: { found: true, address_id: 'addr-102', fiber_mbps: 300, five_g: true },
        startedAt: '2026-03-02T10:00:01.250Z',
        latencyMs: 150,
      },
    ]);
    expect(first?.observed.segments.map((segment) => segment.type)).toEqual([
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(first?.observed.text).toBe(
      'Yes: Acme Fiber 300 is available at 3 Orchard Way. Do you want the plan details?',
    );
    expect(first?.observed.cost).toEqual({ inputTokens: 930, outputTokens: 62 });
    expect(first?.observed.latencyMs).toBe(3000);
    expect(second?.user).toBe('Yes please, how much is it per month?');
    expect(second?.observed.cost).toEqual({ usd: 0.00141, inputTokens: 560, outputTokens: 18 });
    expect(second?.observed.latencyMs).toBe(1600);
    for (const turn of trace?.turns ?? []) expect(Observed.safeParse(turn.observed).success).toBe(true);
  });

  it('prices tokens from a table when the spans carry no cost', async () => {
    const [trace] = tracesFromOtel(parseOtlp(await read('otel-semconv.json')).spans, {
      prices: { 'example-model-1-0301': { input: 2, output: 8 } },
    }).traces;
    expect(trace?.turns[0]?.observed.cost.usd).toBeCloseTo((930 * 2 + 62 * 8) / 1e6, 12);
    expect(trace?.turns[1]?.observed.cost.usd).toBe(0.00141);
  });
});

describe('tracesFromOtel: flat indexed attributes, one trace per turn', () => {
  it('joins the traces of one session and reads prompts, completions and tool spans', async () => {
    const [trace] = tracesFromOtel(parseOtlp(await read('otel-flat.jsonl')).spans).traces;
    expect(trace).toMatchObject({ id: 'sess-port-0042', model: 'example-model-2', issues: [] });
    expect(trace?.turns.map((turn) => turn.user)).toEqual([
      'I want to switch to Acme and keep my number.',
      'It is +1 202 555 0165',
    ]);
    const second = trace?.turns[1]?.observed;
    expect(second?.toolCalls).toMatchObject([
      {
        id: 'toolu_port_1',
        label: 'port.check',
        input: { number: '+12025550165' },
        output: { eligible: true },
      },
    ]);
    expect(second?.text).toBe('Good news: +1 202 555 0165 can move to Acme. Which plan would you like?');
    expect(second?.cost).toEqual({ inputTokens: 720, outputTokens: 56 });
    expect(second?.latencyMs).toBe(3000);
    expect(trace?.turns[0]?.observed.latencyMs).toBe(1300);
  });
});

describe('tracesFromOtel: edge cases', () => {
  const chat = (traceId: string, start: number, user: string, extra: Record<string, unknown> = {}) => ({
    traceId,
    spanId: `${traceId}-${start}`,
    name: 'chat',
    startTimeUnixNano: String(start * 1e9),
    endTimeUnixNano: String((start + 1) * 1e9),
    attributes: Object.entries({
      'gen_ai.operation.name': 'chat',
      'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: user }] }]),
      'gen_ai.output.messages': JSON.stringify([
        { role: 'assistant', parts: [{ type: 'text', content: 'ok' }] },
      ]),
      ...extra,
    }).map(([key, value]) => ({ key, value: { stringValue: value } })),
  });

  it('keeps two traces apart when no conversation id joins them, oldest first', () => {
    const traces = tracesFromOtel(
      parseOtlp(
        JSON.stringify({
          resourceSpans: [{ scopeSpans: [{ spans: [chat('t2', 20, 'b'), chat('t1', 10, 'a')] }] }],
        }),
      ).spans,
    ).traces;
    expect(traces.map((trace) => [trace.id, trace.turns.map((turn) => turn.user)])).toEqual([
      ['t1', ['a']],
      ['t2', ['b']],
    ]);
  });

  it('marks a tool span that failed as a tool error, and notes a span outside any turn', () => {
    const tool = {
      traceId: 't1',
      spanId: 'tool',
      name: 'execute_tool',
      startTimeUnixNano: String(10.5 * 1e9),
      endTimeUnixNano: String(10.6 * 1e9),
      status: { code: 2, message: 'timeout' },
      attributes: [
        { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
        { key: 'gen_ai.tool.name', value: { stringValue: 'lookup' } },
      ],
    };
    const orphan = { ...tool, traceId: 't9', spanId: 'orphan', startTimeUnixNano: '1', endTimeUnixNano: '2' };
    const { traces, issues } = tracesFromOtel(
      parseOtlp(
        JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [chat('t1', 10, 'a'), tool, orphan] }] }] }),
      ).spans,
    );
    const [trace, other] = traces;
    expect(trace?.turns[0]?.observed.toolCalls).toEqual([
      {
        spanId: tool.spanId,
        label: 'lookup',
        input: null,
        error: 'timeout',
        startedAt: '1970-01-01T00:00:10.500Z',
        latencyMs: 100,
      },
    ]);
    expect(other).toBeUndefined();
    expect(trace?.issues).toEqual([]);
    expect(issues).toEqual(['t9: 1 span and no chat span, left out']);
    expect(tracesFromOtel([]).traces).toEqual([]);
  });
});

describe('tracesFromOtel keeps the span tree as observations', () => {
  it('keeps every span with its kind, its parent link and its times', async () => {
    const [trace] = tracesFromOtel(parseOtlp(await read('otel-flat.jsonl')).spans).traces;
    const observations = trace?.observations ?? [];
    expect(observations).toHaveLength(6);
    const ids = new Set(observations.map((entry) => entry.id));
    expect(observations.every((entry) => entry.parentId === undefined || ids.has(entry.parentId))).toBe(true);
    const root = observations.find((entry) => entry.id === 'b200000000000001');
    expect(root).toMatchObject({ kind: 'other', name: 'acme.turn.workflow' });
    expect(root?.parentId).toBeUndefined();
    const tool = observations.find((entry) => entry.id === 'b200000000000003');
    expect(tool).toMatchObject({ kind: 'tool', name: 'port.check.tool', parentId: 'b200000000000001' });
    expect(tool?.start).toBe(new Date(1772450431050).toISOString());
  });
});

describe('tracesFromOtel observations carry level, usage and cost', () => {
  it('gives a chat span its tokens and its priced cost, and a span with an error status the error level', async () => {
    const prices = { 'example-model-2': { input: 2, output: 8 } };
    const [trace] = tracesFromOtel(parseOtlp(await read('otel-flat.jsonl')).spans, { prices }).traces;
    const chat = trace?.observations?.find((entry) => entry.id === 'b200000000000002');
    expect(chat).toMatchObject({
      kind: 'chat',
      level: 'default',
      usage: { inputTokens: 340, outputTokens: 30 },
    });
    expect(chat?.usd).toBeCloseTo((340 * 2) / 1e6 + (30 * 8) / 1e6, 12);
    const tool = trace?.observations?.find((entry) => entry.id === 'b200000000000003');
    expect(tool?.usage).toBeUndefined();
    expect(tool?.usd).toBeUndefined();
    expect(tool?.level).toBe('default');
  });
});

describe('tracesFromOtel observations carry their input and output', () => {
  it('gives a tool observation its arguments and result, and a chat observation its reply text', async () => {
    const [trace] = tracesFromOtel(parseOtlp(await read('otel-flat.jsonl')).spans).traces;
    const tool = trace?.observations?.find((entry) => entry.id === 'b200000000000003');
    expect(tool?.input).toEqual({ number: '+12025550165' });
    expect(tool?.output).toEqual({ eligible: true });
    const chat = trace?.observations?.find((entry) => entry.id === 'b200000000000004');
    expect(chat?.output).toBe('Good news: +1 202 555 0165 can move to Acme. Which plan would you like?');
  });
});
