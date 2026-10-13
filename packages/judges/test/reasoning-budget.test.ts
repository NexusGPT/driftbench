import { describe, expect, it } from 'vitest';
import { createGoogleJudge, createOpenAiJudge } from '../src/clients/chat';
import { createDialectTransport } from '../src/clients/transport';
import { createCouncil } from '../src/council';

// Recorded failure shapes; identifiers and text are fictional.
const empty = {
  openai: {
    choices: [{ message: { content: '' }, finish_reason: 'length' }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8192,
      completion_tokens_details: { reasoning_tokens: 8192 },
    },
  },
  google: {
    candidates: [
      { content: { parts: [{ thought: true, text: 'private reasoning' }] }, finishReason: 'MAX_TOKENS' },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, thoughtsTokenCount: 4092 },
  },
};
const text = '{"checks":[{"id":"polite","reasoning":"A greeting.","evidence":"Hello.","met":true}]}';
const ok = {
  openai: { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
  google: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] },
};
const request = {
  criterion: { name: 'polite', rubric: 'Use a greeting.' },
  transcript: [{ role: 'agent' as const, text: 'Hello.' }],
};
const env = { OPENAI_API_KEY: 'fictional', GEMINI_API_KEY: 'fictional' };
function fixture(provider: keyof typeof empty, repeat = false) {
  // biome-ignore lint/suspicious/noExplicitAny: provider bodies have different wire shapes
  const bodies: Record<string, any>[] = [];
  return {
    bodies,
    fetch: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(bodies.length === 1 || repeat ? empty[provider] : ok[provider]));
    },
  };
}
for (const provider of ['openai', 'google'] as const) {
  const make = provider === 'openai' ? createOpenAiJudge : createGoogleJudge;
  describe(provider, () => {
    it('recovers one empty length result and records its own grader error', async () => {
      const f = fixture(provider);
      const client = make({ model: 'fictional', env, reasoning: 'medium', fetch: f.fetch });
      const result = await client.judge(request);
      expect(result.answer.outcome).toBe('pass');
      expect(f.bodies).toHaveLength(2);
      expect(result.recovery?.kind).toBe('reasoning-budget-exhausted');
      expect(result.recovery?.attempts).toHaveLength(2);
      const second = f.bodies[1] as Record<string, unknown>;
      expect(
        provider === 'openai'
          ? second.reasoning_effort
          : (second.generationConfig as { thinkingConfig: { thinkingLevel: string } }).thinkingConfig
              .thinkingLevel,
      ).toBe('low');
    });
    it('stops after one recovery and counts a distinct error', async () => {
      const f = fixture(provider, true);
      const client = make({ model: 'fictional', env, reasoning: 'medium', fetch: f.fetch });
      await expect(client.judge(request)).rejects.toMatchObject({
        code: 'reasoning-budget-exhausted',
        retryable: false,
      });
      expect(f.bodies).toHaveLength(2);
    });
    it('uses opt-in answer plus reasoning headroom in the transport', async () => {
      const f = fixture(provider);
      const transport = createDialectTransport({
        provider,
        model: 'fictional',
        env,
        fetch: f.fetch,
        reasoning: 'medium',
        tokenBudget: { answerTokens: 4096, reasoningTokens: 8192 },
      });
      const result = await transport.complete({ system: 'Assess.', user: 'Hello.' });
      expect(result.text).toBe(text);
      expect(result.recovery?.kind).toBe('reasoning-budget-exhausted');
      expect(
        provider === 'openai'
          ? f.bodies[0]?.max_completion_tokens
          : f.bodies[0]?.generationConfig.maxOutputTokens,
      ).toBe(12288);
      expect(result.usage?.output).toBe(provider === 'openai' ? 8192 : 4092);
    });
  });
}
it('counts the recovered error in a council without another re-ask', async () => {
  const f = fixture('openai');
  const client = createOpenAiJudge({ model: 'fictional', env, fetch: f.fetch });
  const result = await createCouncil({ mode: 'llm', size: 1, agentFamily: 'none', judges: [client] }).judge(
    request,
  );
  expect(result.errors).toBe(1);
  expect(result.outcome).toBe('pass');
  expect(f.bodies).toHaveLength(2);
});

it('unset tokenBudget preserves the exact successful transport request and fingerprint', async () => {
  for (const provider of ['openai', 'google'] as const) {
    const bodies: string[] = [];
    const make = (extra = {}) =>
      createDialectTransport({
        provider,
        model: 'fictional',
        env,
        ...extra,
        fetch: async (_url, init) => {
          bodies.push(String(init.body));
          return new Response(JSON.stringify(ok[provider]));
        },
      });
    const a = make(),
      b = make({ tokenBudget: undefined });
    const prompt = { system: 'Assess.', user: 'Hello.' };
    expect((await a.complete(prompt)).fingerprint).toBe((await b.complete(prompt)).fingerprint);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toBe(
      JSON.stringify(
        provider === 'openai'
          ? {
              model: 'fictional',
              messages: [
                { role: 'system', content: 'Assess.' },
                { role: 'user', content: 'Hello.' },
              ],
              max_completion_tokens: 4096,
            }
          : {
              systemInstruction: { parts: [{ text: 'Assess.' }] },
              contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }],
              generationConfig: { maxOutputTokens: 4096 },
            },
      ),
    );
    expect(make({ tokenBudget: { answerTokens: 4096, reasoningTokens: 8192 } }).fingerprint).not.toBe(
      a.fingerprint,
    );
  }
});
it('uses a numeric Gemini thinking budget only when explicitly requested', async () => {
  const f = fixture('google');
  await createGoogleJudge({
    model: 'fictional',
    env,
    fetch: f.fetch,
    tokenBudget: { answerTokens: 1024, reasoningTokens: 2048, googleThinkingBudget: true },
  }).judge(request);
  expect(f.bodies[0]?.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 });
});
it('rejects unsupported or invalid budget options before network access', () => {
  for (const tokenBudget of [
    { answerTokens: 0, reasoningTokens: 1 },
    { answerTokens: 1, reasoningTokens: -1 },
  ])
    expect(() => createOpenAiJudge({ model: 'fictional', env, tokenBudget })).toThrow(/tokenBudget/);
  expect(() =>
    createDialectTransport({
      provider: 'claude-cli',
      model: 'fictional',
      tokenBudget: { answerTokens: 1, reasoningTokens: 1 },
    }),
  ).toThrow(/tokenBudget/);
});
