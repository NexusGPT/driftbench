import { describe, expect, it } from 'vitest';
import {
  createAnthropicJudge,
  createGoogleJudge,
  createJevJudge,
  createOpenAiJudge,
  type JudgeRequest,
  MAX_TOKENS,
} from '../src/index';

// biome-ignore lint/suspicious/noExplicitAny: provider bodies and descriptors differ per client
type Json = Record<string, any>;

const REQUEST: JudgeRequest = {
  criterion: { name: 'c', rubric: 'The reply is polite.', pass: 'Polite.', fail: 'Rude.' },
  transcript: [{ role: 'agent', text: 'Good morning.' }],
};
const KEYS = {
  OPENAI_API_KEY: 'k',
  ANTHROPIC_API_KEY: 'k',
  GEMINI_API_KEY: 'k',
  JEV_API_KEY: 'k',
  JEV_URL: 'https://jev.example.test/x',
};
const MODELS = { OPENAI_JUDGE_MODEL: 'm', ANTHROPIC_JUDGE_MODEL: 'm', GOOGLE_JUDGE_MODEL: 'm' };

async function sent(
  make: (o: Record<string, unknown>) => { settings?: string; judge: (r: JudgeRequest) => Promise<unknown> },
) {
  const bodies: Json[] = [];
  const client = make({
    env: { ...KEYS, ...MODELS },
    maxRetries: 0,
    fetch: async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await client.judge(REQUEST);
  return {
    settings: JSON.parse(client.settings ?? 'null') as Json | null,
    body: bodies[0] ?? {},
  };
}

describe('the settings descriptor of a client', () => {
  it('openai: names the temperature, the retry policy, the output cap and the response format it sends', async () => {
    const { settings, body } = await sent(createOpenAiJudge as never);
    expect(settings?.client).toBe('openai-chat');
    expect(body.temperature).toBe(settings?.temperature);
    expect(body.max_completion_tokens).toBe(settings?.maxTokens.normal);
    expect(settings?.maxTokens).toEqual(MAX_TOKENS);
    expect(body.response_format.type).toBe(settings?.responseFormat);
    expect(settings?.temperatureRetry).toMatch(/400/);
  });
  it('anthropic: names the temperature and the output cap it sends', async () => {
    const { settings, body } = await sent(createAnthropicJudge as never);
    expect(settings?.client).toBe('anthropic-messages');
    expect(body.temperature).toBe(settings?.temperature);
    expect(body.max_tokens).toBe(settings?.maxTokens.normal);
  });
  it('google: names the temperature, the output cap and the mime type it sends', async () => {
    const { settings, body } = await sent(createGoogleJudge as never);
    expect(settings?.client).toBe('google-generate-content');
    expect(body.generationConfig.temperature).toBe(settings?.temperature);
    expect(body.generationConfig.maxOutputTokens).toBe(settings?.maxTokens.normal);
    expect(body.generationConfig.responseMimeType).toBe(settings?.responseMimeType);
  });
  it('jev: names the question type, the focus line and its probability bounds', async () => {
    const { settings, body } = await sent(createJevJudge as never);
    expect(settings?.client).toBe('jev');
    expect(body.questions.verdict.type).toBe(settings?.questionType);
    expect(body.questions.verdict.instructions.focus).toBe(settings?.focus);
    expect(settings).toHaveProperty('passAt', null);
  });
  it('changes with a bound the caller sets, so another bound never replays an old recording', async () => {
    const a = await sent(((o: Record<string, unknown>) =>
      createJevJudge({ ...o, passAt: 0.6 } as never)) as never);
    const b = await sent(createJevJudge as never);
    expect(a.settings).not.toEqual(b.settings);
  });
});
