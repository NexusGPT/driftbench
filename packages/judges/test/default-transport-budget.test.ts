import { describe, expect, it } from 'vitest';
import { buildDialectRequest, createDialectTransport } from '../src/clients/transport';

const env = { OPENAI_API_KEY: 'fixture', GEMINI_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture' };
const prompt = { system: 'Judge the supplied data.', user: 'Fixture.' };

describe('per-request raw transport output budget', () => {
  for (const provider of ['openai', 'google', 'anthropic'] as const) {
    it(`${provider} honors request override and preserves its configured default`, async () => {
      const bodies: Record<string, unknown>[] = [];
      const transport = createDialectTransport({
        provider,
        model: 'fixture',
        env,
        maxRetries: 0,
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)));
          return new Response('{}', { status: 200 });
        },
      });
      await transport.complete(prompt);
      await transport.complete({ ...prompt, maxTokens: 6144 });
      await transport.complete(prompt);
      const limits = bodies.map((body) =>
        provider === 'google'
          ? (body.generationConfig as { maxOutputTokens: number }).maxOutputTokens
          : provider === 'openai'
            ? body.max_completion_tokens
            : body.max_tokens,
      );
      expect(limits).toEqual([4096, 6144, 4096]);
    });
  }
  it('uses an explicit configured transport budget when the request omits one', async () => {
    const limits: number[] = [];
    const transport = createDialectTransport({
      provider: 'openai',
      model: 'fixture',
      env,
      maxTokens: 2048,
      maxRetries: 0,
      fetch: async (_url, init) => {
        limits.push(JSON.parse(String(init.body)).max_completion_tokens);
        return new Response('{}', { status: 200 });
      },
    });
    await transport.complete(prompt);
    await transport.complete({ ...prompt, maxTokens: 8192 });
    expect(limits).toEqual([2048, 8192]);
  });
  it('includes the override in prompt and completion identity without changing omitted defaults', async () => {
    const base = buildDialectRequest('openai', prompt);
    const omitted = buildDialectRequest('openai', { ...prompt, maxTokens: undefined });
    const large = buildDialectRequest('openai', { ...prompt, maxTokens: 6144 });
    expect(omitted.fingerprint).toBe(base.fingerprint);
    expect(large.fingerprint).not.toBe(base.fingerprint);
    const transport = createDialectTransport({
      provider: 'openai',
      model: 'fixture',
      env,
      maxRetries: 0,
      fetch: async () => new Response('{}', { status: 200 }),
    });
    const normal = await transport.complete(prompt);
    const expanded = await transport.complete({ ...prompt, maxTokens: 6144 });
    expect(expanded.fingerprint).not.toBe(normal.fingerprint);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid request limit %s before sending',
    async (maxTokens) => {
      let calls = 0;
      const transport = createDialectTransport({
        provider: 'openai',
        model: 'fixture',
        env,
        maxRetries: 0,
        fetch: async () => {
          calls++;
          return new Response('{}', { status: 200 });
        },
      });
      expect(() => buildDialectRequest('openai', { ...prompt, maxTokens })).toThrow(/maxTokens/);
      await expect(transport.complete({ ...prompt, maxTokens })).rejects.toThrow(/maxTokens/);
      expect(calls).toBe(0);
    },
  );
});
