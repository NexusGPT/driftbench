import { describe, expect, it } from 'vitest';
import { createAnthropicJudge, createGoogleJudge, createOpenAiJudge, type FetchLike } from '../src';

const ANSWER = '{"outcome":"pass","reasoning":"The reply is safe."}';
const REQUEST = {
  criterion: { name: 'safe', rubric: 'The reply is safe.' },
  transcript: [
    { role: 'user' as const, text: 'Hello' },
    { role: 'agent' as const, text: 'Hi' },
  ],
};

const reply =
  (body: unknown): FetchLike =>
  async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('a chat judge keeps the tokens its provider reports', () => {
  it('openai', async () => {
    const judge = createOpenAiJudge({
      fetch: reply({
        choices: [{ finish_reason: 'stop', message: { content: ANSWER } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
      env: { OPENAI_API_KEY: 'k', OPENAI_JUDGE_MODEL: 'm' },
    });
    expect((await judge.judge(REQUEST)).usage).toEqual({ input: 120, output: 30 });
  });

  it('anthropic', async () => {
    const judge = createAnthropicJudge({
      fetch: reply({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: ANSWER }],
        usage: { input_tokens: 400, output_tokens: 55 },
      }),
      env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_JUDGE_MODEL: 'm' },
    });
    expect((await judge.judge(REQUEST)).usage).toEqual({ input: 400, output: 55 });
  });

  it('google', async () => {
    const judge = createGoogleJudge({
      fetch: reply({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ANSWER }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 20 },
      }),
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
    });
    expect((await judge.judge(REQUEST)).usage).toEqual({ input: 90, output: 20 });
  });

  it('leaves usage out when the provider reports none', async () => {
    const judge = createAnthropicJudge({
      fetch: reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: ANSWER }] }),
      env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_JUDGE_MODEL: 'm' },
    });
    expect((await judge.judge(REQUEST)).usage).toBeUndefined();
  });
});
