import { describe, expect, it } from 'vitest';
import { usageFromResponse } from '../src/clients/usage';

const path = '../src/clients/transport';
const prompt = { system: 'Answer the question.', user: 'What is two plus two?' };
const schema = {
  type: 'object',
  properties: { score: { type: ['integer', 'null'] } },
  required: ['score'],
  additionalProperties: false,
};
// biome-ignore lint/suspicious/noExplicitAny: provider payload shapes vary
type Body = any;

describe('schema-independent dialect transport', () => {
  it('builds plain OpenAI and Google calls without inserting a JSON contract', async () => {
    const { buildDialectRequest } = await import(path);
    const openai = buildDialectRequest('openai', prompt);
    const google = buildDialectRequest('google', prompt);
    expect(openai.payload).toEqual({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });
    expect(google.payload).toEqual({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
    });
    expect(openai.fingerprint).not.toBe(google.fingerprint);
  });

  it('builds strict optional schema and keys fingerprints on schema and reasoning', async () => {
    const { buildDialectRequest } = await import(path);
    const one = buildDialectRequest('openai', { ...prompt, schema, reasoning: 'medium' });
    expect(one.payload.response_format.json_schema).toEqual({ name: 'judge_answer', strict: true, schema });
    expect(one.payload.reasoning_effort).toBe('medium');
    expect(one.fingerprint).not.toBe(
      buildDialectRequest('openai', { ...prompt, schema, reasoning: 'high' }).fingerprint,
    );
    expect(one.fingerprint).not.toBe(
      buildDialectRequest('openai', { ...prompt, reasoning: 'medium' }).fingerprint,
    );
    const google = buildDialectRequest('google', { ...prompt, schema, reasoning: 'medium' });
    expect(google.payload.generationConfig.responseSchema.properties.score).toEqual({
      type: 'integer',
      nullable: true,
    });
    expect(google.payload.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
  });

  it('exposes the frozen benchmark settings without imposing general-client defaults', async () => {
    const { FROZEN_BENCHMARK_REASONING, createDialectTransport } = await import(path);
    expect(FROZEN_BENCHMARK_REASONING).toEqual({
      'gpt-6-luna': 'medium',
      'gemini-3.8-flash': 'medium',
      'claude-haiku-5-5': undefined,
      'jev-latest': undefined,
    });
    const options = { provider: 'openai', model: 'gpt-6-luna', env: { OPENAI_API_KEY: 'test' } };
    expect(createDialectTransport(options).reasoning).toBeUndefined();
    expect(createDialectTransport({ ...options, reasoning: 'medium' }).fingerprint).not.toBe(
      createDialectTransport(options).fingerprint,
    );
  });

  it.each(['openai', 'google', 'anthropic'])('returns raw plain text and usage from %s', async (provider) => {
    const { createDialectTransport } = await import(path);
    const bodies: Body[] = [];
    const payloads = {
      openai: {
        choices: [{ message: { content: '4' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 9, completion_tokens: 1 },
      },
      google: {
        candidates: [
          { content: { parts: [{ thought: true, text: 'hidden' }, { text: '4' }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1 },
      },
      anthropic: {
        content: [{ type: 'text', text: '4' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 9, output_tokens: 1 },
      },
    };
    const client = createDialectTransport({
      provider,
      model: 'test-model',
      maxRetries: 0,
      env: {
        OPENAI_API_KEY: 'private-value',
        GEMINI_API_KEY: 'private-value',
        ANTHROPIC_API_KEY: 'private-value',
      },
      fetch: async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(payloads[provider as keyof typeof payloads]), { status: 200 });
      },
    });
    const result = await client.complete(prompt);
    expect(result.text).toBe('4');
    expect(result.usage).toEqual({ input: 9, output: 1 });
    expect(JSON.parse(result.raw)).toEqual(payloads[provider as keyof typeof payloads]);
    expect(JSON.stringify(client)).not.toContain('private-value');
    expect(JSON.stringify(bodies)).not.toContain('private-value');
  });

  it('lets a request override the OpenAI reasoning setting and reports truncation', async () => {
    const { createDialectTransport } = await import(path);
    const bodies: Body[] = [];
    const client = createDialectTransport({
      provider: 'openai',
      model: 'test',
      reasoning: 'medium',
      env: { OPENAI_API_KEY: 'test' },
      fetch: async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
        );
      },
    });
    const result = await client.complete({ ...prompt, reasoning: 'high' });
    expect(bodies[0].reasoning_effort).toBe('high');
    expect(result.truncated).toBe(true);
  });

  it('includes Google thinking tokens in completion usage without changing legacy usage', async () => {
    const { createDialectTransport } = await import(path);
    const payload = {
      candidates: [{ content: { parts: [{ text: '4' }] } }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1, thoughtsTokenCount: 23 },
    };
    const client = createDialectTransport({
      provider: 'google',
      model: 'test',
      env: { GEMINI_API_KEY: 'test' },
      maxRetries: 0,
      fetch: async () => new Response(JSON.stringify(payload)),
    });
    expect((await client.complete(prompt)).usage).toEqual({ input: 9, output: 24 });
    expect(usageFromResponse('google', payload)).toEqual({ input: 9, output: 1 });
  });

  it('uses scratchpad plus the supplied schema for Anthropic without a winner contract', async () => {
    const { buildDialectRequest } = await import(path);
    const result = buildDialectRequest('anthropic', { ...prompt, schema });
    expect(result.dialect).toBe('scratchpad-json');
    expect(result.payload.messages[0].content).toContain('Think first in plain text.');
    expect(result.payload.messages[0].content).toContain(JSON.stringify(schema));
    expect(result.payload.system).toBe(prompt.system);
    expect(() => buildDialectRequest('anthropic', { ...prompt, reasoning: 'medium' })).toThrow(/reasoning/);
  });

  it('reuses the isolated Claude process runner for schema-free plain output and cost', async () => {
    const { createDialectTransport } = await import(path);
    const script = `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'4',total_cost_usd:0.001})));`;
    const client = createDialectTransport({
      provider: 'claude-cli',
      model: 'test',
      env: {},
      command: process.execPath,
      commandArgs: ['--eval', script, '--'],
    });
    const result = await client.complete(prompt);
    expect(result).toMatchObject({ text: '4', costUsd: 0.001, dialect: 'scratchpad-json' });
  });

  it.each([
    { isError: true, exitCode: 0 },
    { isError: false, exitCode: 7 },
  ])(
    'retains Claude failure receipts with is_error=$isError and exit=$exitCode',
    async ({ isError, exitCode }) => {
      const { createDialectTransport } = await import(path);
      const usage = {
        input_tokens: 11,
        output_tokens: 5,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      };
      const raw = `${JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: isError,
        result: 'provider unavailable after partial generation',
        usage,
        total_cost_usd: 0.0123,
      })}\n`;
      const script = `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(raw)}); process.exitCode = ${exitCode}; });`;
      const client = createDialectTransport({
        provider: 'claude-cli',
        model: 'test',
        env: {},
        command: process.execPath,
        commandArgs: ['--eval', script, '--'],
      });
      await expect(client.complete(prompt)).rejects.toMatchObject({
        code: 'http',
        message: expect.stringContaining('provider unavailable after partial generation'),
        raw: raw.trim(),
        category: 'other',
        retryable: false,
        exitCode,
        usage,
        costUsd: 0.0123,
      });
    },
  );

  it.each(['not JSON\n', JSON.stringify({ type: 'other', usage: { input_tokens: 3 } })])(
    'retains raw output and exit code when Claude returns no valid result: %s',
    async (raw) => {
      const { createDialectTransport } = await import(path);
      const script = `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(raw)}); process.exitCode = 2; });`;
      const client = createDialectTransport({
        provider: 'claude-cli',
        model: 'test',
        env: {},
        command: process.execPath,
        commandArgs: ['--eval', script, '--'],
      });
      await expect(client.complete(prompt)).rejects.toMatchObject({ code: 'bad_response', raw, exitCode: 2 });
    },
  );
});
