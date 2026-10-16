import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { requestKey } from '../src/cassette';
import type { ClientOptions } from '../src/client';
import { createAnthropicJudge, createGoogleJudge, createOpenAiJudge } from '../src/clients/chat';
import { createHttpJudge } from '../src/clients/http-json';
import { createJevJudge, createOpenAiDecisionsJudge } from '../src/clients/system1';
import { type JudgeRequest, MAX_TOKENS, REASONING_TOKENS } from '../src/contract';

// The baselines below were captured under prompt version 1 and decoder version 1, which stay selectable.
const REQUEST: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply is polite.' },
  transcript: [{ role: 'agent', text: 'Good morning.' }],
  criterionPromptVersion: 1,
  criterionDecoderVersion: 1,
};
const env = {
  OPENAI_API_KEY: 'k',
  OPENAI_JUDGE_MODEL: 'm',
  ANTHROPIC_API_KEY: 'k',
  ANTHROPIC_JUDGE_MODEL: 'm',
  GEMINI_API_KEY: 'k',
  GOOGLE_JUDGE_MODEL: 'm',
};
const clients = [
  ['openai', createOpenAiJudge],
  ['google', createGoogleJudge],
  ['anthropic', createAnthropicJudge],
] as const;
// Captured before reasoning support; hashes cover the exact serialized request bytes.
const BASELINES = {
  openai: {
    body: '019fba192eec75c26948ea081f306773c68f796a1ba28e3b9377e9c92205238f',
    settings:
      '{"client":"openai-chat","temperature":0,"maxTokens":{"normal":1024,"large":4096},"temperatureRetry":"drop on a 400 that names it","responseFormat":"json_schema"}',
    requestKey: 'd303f86f20d7',
  },
  google: {
    body: '4f7d2632bf19e108f4c8884d58fcaa23bef77ce4ed4868a7bb4b6333aebb4951',
    settings:
      '{"client":"google-generate-content","temperature":0,"maxTokens":{"normal":1024,"large":4096},"responseMimeType":"application/json"}',
    requestKey: 'e3e89f430f19',
  },
  anthropic: {
    body: '403bd1988b2fb70f7508fd161c5cb45f5c6c6226da68063fa7bf3dfcc761c1ad',
    settings:
      '{"client":"anthropic-messages","temperature":0,"maxTokens":{"normal":1024,"large":4096},"anthropicVersion":"2023-06-01"}',
    requestKey: 'a4707f3a7b2c',
  },
};

async function capture(
  make: (options: ClientOptions) => ReturnType<typeof createOpenAiJudge>,
  extra: Partial<ClientOptions> = {},
) {
  const bodies: string[] = [];
  const client = make({
    env,
    maxRetries: 0,
    ...extra,
    fetch: async (_url, init) => {
      bodies.push(String(init.body));
      return new Response('{}', { status: 200 });
    },
  });
  await client.judge(REQUEST);
  return { client, body: bodies[0] as string };
}

describe('chat client defaults remain byte stable', () => {
  for (const [name, make] of clients) {
    it(`${name} preserves its body, settings and exact request key`, async () => {
      const { client, body } = await capture(make);
      expect({
        body: createHash('sha256').update(body).digest('hex'),
        settings: client.settings,
        requestKey: requestKey(REQUEST, client),
      }).toEqual(BASELINES[name]);
      const explicitUndefined = await capture(make, { reasoning: undefined });
      expect(explicitUndefined.body).toBe(body);
      expect(explicitUndefined.client.settings).toBe(client.settings);
      expect(requestKey(REQUEST, explicitUndefined.client)).toBe(BASELINES[name].requestKey);
    });
  }
});

describe('explicit reasoning on chat clients', () => {
  for (const [name, make] of clients.slice(0, 2)) {
    for (const reasoning of ['low', 'medium', 'high'] as const) {
      it(`${name} sends ${reasoning} and gives it a distinct cassette key`, async () => {
        const { client, body } = await capture(make, { reasoning });
        const parsed = JSON.parse(body);
        expect(
          name === 'openai' ? parsed.reasoning_effort : parsed.generationConfig.thinkingConfig?.thinkingLevel,
        ).toBe(reasoning);
        expect(JSON.parse(client.settings as string).reasoning).toBe(reasoning);
        const plain = await capture(make);
        expect(requestKey(REQUEST, client)).not.toBe(requestKey(REQUEST, plain.client));
        for (const other of ['low', 'medium', 'high'] as const) {
          if (other === reasoning) continue;
          const different = await capture(make, { reasoning: other });
          expect(requestKey(REQUEST, client)).not.toBe(requestKey(REQUEST, different.client));
        }
      });
    }
  }
  for (const [name, make] of clients.slice(0, 2)) {
    it(`${name} adds the reasoning room of its level to the token limit, for both budgets`, async () => {
      const limit = (body: string) => {
        const parsed = JSON.parse(body);
        return name === 'openai' ? parsed.max_completion_tokens : parsed.generationConfig.maxOutputTokens;
      };
      expect(limit((await capture(make)).body)).toBe(MAX_TOKENS.normal);
      for (const reasoning of ['low', 'medium', 'high'] as const) {
        const { client, body } = await capture(make, { reasoning });
        expect(limit(body)).toBe(MAX_TOKENS.normal + REASONING_TOKENS[reasoning]);
        expect(JSON.parse(client.settings as string).reasoningTokens).toEqual(REASONING_TOKENS);
        const bodies: string[] = [];
        const large = make({
          env,
          maxRetries: 0,
          reasoning,
          fetch: async (_url, init) => {
            bodies.push(String(init.body));
            return new Response('{}', { status: 200 });
          },
        });
        await large.judge({ ...REQUEST, budget: 'large' });
        expect(limit(bodies[0] as string)).toBe(MAX_TOKENS.large + REASONING_TOKENS[reasoning]);
      }
    });
  }
  it('rejects unsupported Anthropic reasoning before any request', () => {
    expect(() => createAnthropicJudge({ env, reasoning: 'high' })).toThrow(/reasoning.*not supported/i);
  });
  it('rejects HTTP reasoning on a non-ledger request before sending it', async () => {
    const client = createHttpJudge({
      url: 'https://judge.example.test',
      family: 'custom',
      reasoning: 'high',
      fetch: async () => {
        throw new Error('Unexpected network request');
      },
    });
    await expect(client.judge(REQUEST)).rejects.toThrow(
      'reasoning is supported only by HTTP pair-ledger requests',
    );
  });
  for (const [name, make] of [
    ['Jev', createJevJudge],
    ['OpenAI Decisions', createOpenAiDecisionsJudge],
  ] as const) {
    it(`rejects unsupported ${name} reasoning before any request`, () => {
      expect(() =>
        make({
          env: {
            ...env,
            OPENAI_DECISIONS_MODEL: 'm',
            JEV_URL: 'https://jev.example.test/x',
            JEV_API_KEY: 'k',
          },
          reasoning: 'high',
        }),
      ).toThrow(`reasoning is not supported by the ${name} client`);
    });
  }
});
