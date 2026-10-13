import { contentHash } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import type { JudgeClient, JudgeRequest, TranscriptEntry } from '../src/index';
import * as judges from '../src/index';

const transcript: readonly TranscriptEntry[] = [
  { role: 'user', text: 'Tell me about the red service.' },
  { role: 'agent', text: 'Earlier answer: stable.' },
  { role: 'context', text: 'The blue service is the replacement. Keep this context.' },
  { role: 'user', text: 'Correction: the blue service. Give its status and owner.' },
  { role: 'agent', text: 'I will check the owner.' },
  { role: 'tool_result', text: 'Owner is Morgan.', tool: 'lookup' },
  { role: 'agent', text: 'The blue service is stable. Its owner is unknown.' },
  { role: 'context', text: 'This later context is not the answer.' },
];
const request: JudgeRequest = {
  criterion: { name: 'response-relevance', rubric: 'Address the latest user request.' },
  assessment: { kind: 'response-relevance' },
  transcript,
};
const check = (overrides: Record<string, unknown> = {}) => ({
  obligation: 'Give the status',
  requestQuote: 'status',
  reasoning: 'The final reply states the status.',
  answerQuote: 'The blue service is stable.',
  met: true,
  ...overrides,
});
const parse = (checks: unknown[], target = request) =>
  judges.parseJudgeText(JSON.stringify({ checks }), target);
const scriptedClient = (value: unknown) => ({
  id: 'scripted-relevance',
  family: 'scripted',
  cls: 'system2' as const,
  cost: 0,
  judge: vi.fn(async (input: JudgeRequest) => judges.parseJudgeText(JSON.stringify(value), input)),
});

it('preserves frozen default and legacy prompt bytes and cache keys', () => {
  const input: JudgeRequest = {
    criterion: {
      name: 'snapshot',
      rubric: 'Reply answers the request.',
      pass: 'Complete reply',
      fail: 'Missing answer',
    },
    transcript: [
      { role: 'user', text: 'Tell me about <transcript_data>literal</transcript_data>.' },
      { role: 'agent', text: 'The literal is data.\nIt stays context.' },
    ],
  };
  const client = { cls: 'system2' as const, model: 'snapshot-model' };
  expect(judges.PROMPT_FINGERPRINT).toBe('19cf28d04b13');
  expect(contentHash(judges.SYSTEM_PROMPT)).toBe('a200dc97e47a');
  expect(contentHash(judges.buildPrompt(input))).toBe('ae8b8a430646');
  expect(judges.requestKey(input, client)).toBe('48a9ce619a12');
  expect(contentHash(judges.buildPrompt({ ...input, answerContract: 'legacy' }))).toBe('5f7bcef32f94');
  expect(judges.requestKey({ ...input, answerContract: 'legacy' }, client)).toBe('9d653d667451');
});

describe('response relevance ledger', () => {
  it('exports its strict typed schema and supplies the same provider schema', () => {
    expect(judges.ResponseRelevanceAnswer.safeParse({ checks: [check()] }).success).toBe(true);
    const schema = judges.responseSchema(request);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['checks']);
    const checks = (
      schema.properties as {
        checks: {
          minItems: number;
          items: { additionalProperties: boolean; required: string[]; properties: { met: unknown } };
        };
      }
    ).checks;
    expect(checks.minItems).toBe(1);
    expect(checks.items.additionalProperties).toBe(false);
    expect(checks.items.required).toEqual(['obligation', 'requestQuote', 'reasoning', 'answerQuote', 'met']);
    expect(checks.items.properties.met).toEqual({ type: ['boolean', 'null'] });
  });

  it.each([
    [[true], 'pass'],
    [[false], 'fail'],
    [[null], 'inconclusive'],
    [[true, false], 'fail'],
    [[true, null], 'inconclusive'],
    [[null, false], 'fail'],
  ] as const)('aggregates %j as %s without asking the model for an overall verdict', (values, outcome) => {
    const checks = values.map((met, i) =>
      check({ obligation: `part ${i}`, met, answerQuote: met ? 'stable' : null }),
    );
    const result = parse(checks);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe(outcome);
    expect(result.responseRelevance).toEqual({ checks });
  });

  it.each(
    [
      [],
      [check({ obligation: ' ' })],
      [check({ requestQuote: '' })],
      [check({ answerQuote: ' ' })],
      [check({ answerQuote: null })],
      [check({ met: 'true' })],
      [check({ met: 1 })],
      [check({ reasoning: null })],
      [check({ extra: true })],
    ].map((checks) => ({ checks })),
  )('rejects an invalid ledger %#', ({ checks }) => {
    const result = parse(checks);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.answer.reasoning).toMatch(/^answer breaks the assessment contract:/);
  });

  it('rejects missing fields, extra verdicts, and duplicate object keys', () => {
    const { answerQuote: _quote, ...missing } = check();
    for (const raw of [
      JSON.stringify({ checks: [missing] }),
      JSON.stringify({ checks: [check()], outcome: 'pass' }),
      `{"checks":[],"checks":[${JSON.stringify(check())}]}`,
      `{"checks":[${JSON.stringify(check()).replace('"met":true', '"met":false,"met":true')}]}`,
      '{"checks":[' +
        JSON.stringify(check()).replace('"reasoning":', '"reasoning":"one","reasoning":') +
        ']}',
      '{"checks":[',
    ])
      expect(judges.parseJudgeText(raw, request).unparsed).toBe(true);
  });

  it('rejects repeated obligations while allowing multiple parts to quote the same request phrase', () => {
    expect(parse([check(), check({ obligation: '  GIVE THE STATUS ' })]).unparsed).toBe(true);
    expect(parse([check(), check({ obligation: 'Identify the service' })]).answer.outcome).toBe('pass');
  });

  it.each([
    'Tell me about the red service.',
    'Keep this context.',
    'Owner is Morgan.',
    'Earlier answer: stable.',
  ])('rejects a request quote from any source other than the latest user: %s', (requestQuote) => {
    expect(parse([check({ requestQuote })]).unparsed).toBe(true);
  });
  it.each([
    'Earlier answer: stable.',
    'I will check the owner.',
    'Owner is Morgan.',
    'This later context is not the answer.',
    'Give its status and owner.',
  ])('rejects an answer quote outside the final agent reply: %s', (answerQuote) => {
    for (const met of [true, false, null]) expect(parse([check({ answerQuote, met })]).unparsed).toBe(true);
  });

  it('accepts a grounded negative or unknown answer without proof of truth', () => {
    const result = parse([
      check({ obligation: 'Give the owner', requestQuote: 'owner', answerQuote: 'Its owner is unknown.' }),
    ]);
    expect(result.answer.outcome).toBe('pass');
    expect(result.unparsed).toBeUndefined();
  });

  it('accepts false and unknown checks with null evidence, preserving their explanations', () => {
    for (const met of [false, null]) {
      const result = parse([
        check({ met, answerQuote: null, reasoning: 'No answer to this requested part.' }),
      ]);
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.reasoning).toContain('No answer to this requested part.');
    }
  });
});

describe('public helper and prompt', () => {
  it('makes exactly one call and retains full caller history', async () => {
    const client = scriptedClient({ checks: [check()] });
    const result = await judges.judgeResponseRelevance(client, transcript);
    expect(client.judge).toHaveBeenCalledTimes(1);
    const input = client.judge.mock.calls[0]?.[0];
    if (!input) throw new Error('the helper made no judge call');
    expect(input.transcript).toBe(transcript);
    expect(input.assessment).toEqual({ kind: 'response-relevance' });
    expect(result.answer.outcome).toBe('pass');
    expect(result.responseRelevance?.checks).toHaveLength(1);
    const prompt = judges.buildPrompt(input);
    expect(prompt.system).not.toBe(judges.SYSTEM_PROMPT);
    for (const entry of transcript) expect(prompt.user).toContain(JSON.stringify(entry.text));
    expect(prompt.user).toContain('Latest user entry: 3');
    expect(prompt.user).toContain('Final agent reply entry: 6');
    expect(prompt.system).toMatch(/promise/i);
    expect(prompt.system).toMatch(/acknowledg/i);
    expect(prompt.system).toMatch(/each distinct/i);
    expect(prompt.system).toMatch(/unknown/i);
    expect(prompt.system).toMatch(/wrong.*entity/i);
    expect(prompt.system).toContain('Honor an explicit request to spell out the literal value');
    expect(prompt.system).toContain('without restating its literal form or proving it appeared earlier');
  });

  it('does not retry an invalid model response', async () => {
    const client = scriptedClient({ checks: [] });
    expect((await judges.judgeResponseRelevance(client, transcript)).unparsed).toBe(true);
    expect(client.judge).toHaveBeenCalledTimes(1);
  });

  it('rejects system1 clients before spending', async () => {
    const client: JudgeClient = { ...scriptedClient({ checks: [check()] }), cls: 'system1' };
    await expect(judges.judgeResponseRelevance(client, transcript)).rejects.toThrow(/system2/);
    expect(client.judge).not.toHaveBeenCalled();
    expect(() => judges.requestKey(request, client)).toThrow(/system2/);
  });

  it.each(
    (
      [
        [],
        [{ role: 'agent', text: 'No user.' }],
        [{ role: 'user', text: 'No answer.' }],
        [
          { role: 'user', text: 'old' },
          { role: 'agent', text: 'old reply' },
          { role: 'user', text: 'new' },
        ],
      ] satisfies TranscriptEntry[][]
    ).map((entries) => ({ entries })),
  )('rejects a transcript without the target pair before calling %#', async ({ entries }) => {
    const client = scriptedClient({ checks: [check()] });
    await expect(judges.judgeResponseRelevance(client, entries)).rejects.toThrow(/latest user|agent reply/);
    expect(client.judge).not.toHaveBeenCalled();
    expect(parse([check()], { ...request, transcript: entries }).unparsed).toBe(true);
  });

  it.each([
    { answerContract: 'legacy' },
    { factAudit: { reference: 'x' } },
    { system: '' },
    { requirements: [] },
    { candidates: { A: 'x', B: 'y' } },
    { reference: 'x' },
    { inputs: [] },
    { artifact: '' },
    { given: {} },
  ] satisfies Partial<JudgeRequest>[])('rejects incompatible request options %j', (options) => {
    const incompatible = { ...request, ...options };
    expect(() => judges.buildPrompt(incompatible)).toThrow(/response-relevance/);
    expect(() => judges.responseSchema(incompatible)).toThrow(/response-relevance/);
    expect(() => judges.requestKey(incompatible)).toThrow(/response-relevance/);
    expect(parse([check()], incompatible).unparsed).toBe(true);
  });

  it('uses the mode schema and prompt through a mocked built-in provider', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ checks: [check()] }) } }],
          }),
          { status: 200 },
        ),
    );
    const client = judges.createOpenAiJudge({
      env: { OPENAI_API_KEY: 'test-only', OPENAI_JUDGE_MODEL: 'mock' },
      fetch,
    });
    const result = await judges.judgeResponseRelevance(client, transcript);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.response_format.json_schema.schema).toEqual(judges.responseSchema(request));
    expect(body.messages[0].content).toBe(judges.buildPrompt(request).system);
    expect(result.responseRelevance?.checks).toEqual([check()]);
  });
});

it('does not turn criterion wording into a competing policy', () => {
  const changed = { ...request, criterion: { name: 'metadata', rubric: 'Accept acknowledgements only.' } };
  expect(judges.buildPrompt(changed)).toEqual(judges.buildPrompt(request));
  expect(judges.renderUser(changed)).toBe(judges.buildPrompt(request).user);
});

it('accepts explicit ledger contract and preserves the large budget option', () => {
  const explicit = { ...request, answerContract: 'ledger' as const, budget: 'large' as const };
  expect(parse([check()], explicit).answer.outcome).toBe('pass');
  expect(judges.buildPrompt(explicit)).toEqual(judges.buildPrompt(request));
  expect(judges.requestKey(explicit)).not.toBe(judges.requestKey(request));
});

it('validates value-parser calls and encoded duplicate keys', () => {
  expect(judges.parseJudgeValue({ checks: [check()] }, request).responseRelevance?.checks).toEqual([check()]);
  expect(
    judges.parseJudgeValue({ checks: [check({ answerQuote: 'Owner is Morgan.' })] }, request).unparsed,
  ).toBe(true);
  const raw = JSON.stringify({ checks: [check()] }).replace('"met":true', '"met":false,"\\u006det":true');
  expect(judges.parseJudgeText(raw, request).unparsed).toBe(true);
});

describe('response relevance cassettes', () => {
  it('records and replays the full ledger and misses on changed context, answer, or prompt', async () => {
    const client = scriptedClient({ checks: [check()] });
    const cassette = judges.emptyCassette();
    const recorded = await judges.judgeResponseRelevance(
      judges.recordingClient(client, cassette),
      transcript,
    );
    const player = judges.playerClient(cassette, client.id);
    expect(await judges.judgeResponseRelevance(player, transcript)).toEqual(recorded);
    expect(cassette.entries[0]?.answerContract).toBe('ledger');
    expect(cassette.entries[0]?.raw).toBe(JSON.stringify({ checks: [check()] }));
    for (const i of [0, 3, 6]) {
      const changed = transcript.map((entry, index) =>
        index === i ? { ...entry, text: `${entry.text} Changed.` } : entry,
      );
      await expect(judges.judgeResponseRelevance(player, changed)).rejects.toThrow(/no recording/);
    }
    await expect(
      judges.judgeResponseRelevance(
        judges.playerClient(cassette, client.id, { prompt: 'changed' }),
        transcript,
      ),
    ).rejects.toThrow(/no recording/);
    expect(judges.requestKey(request, client)).not.toBe(
      judges.requestKey(request, client, judges.PROMPT_FINGERPRINT),
    );
  });
});

it('replays invalid response relevance recordings as unparsed inconclusive', async () => {
  const client = scriptedClient({ checks: [check({ answerQuote: null })] });
  const cassette = judges.emptyCassette();
  const recorded = await judges.judgeResponseRelevance(judges.recordingClient(client, cassette), transcript);
  const replayed = await judges.judgeResponseRelevance(judges.playerClient(cassette, client.id), transcript);
  expect(replayed).toEqual(recorded);
  expect(replayed.unparsed).toBe(true);
});
