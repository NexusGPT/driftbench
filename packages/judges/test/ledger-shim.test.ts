import { describe, expect, it, vi } from 'vitest';

const shimPath = '../../../examples/judge-benchmarks/src/llm-shim.mjs';
const schema = {
  type: 'object',
  properties: { value: { type: ['integer', 'null'] } },
  required: ['value'],
  additionalProperties: false,
};
// biome-ignore lint/suspicious/noExplicitAny: mocked provider bodies intentionally have different shapes
type Body = any;
async function run(
  model: string,
  args: string[] = [],
  response: unknown = {},
  env: Record<string, string> = {},
) {
  const { runShim } = await import(shimPath);
  const bodies: Body[] = [];
  const answer = await runShim({
    argv: ['--model', model, '--system-prompt', 'Grade.', ...args],
    input: 'First.\nSecond.',
    env,
    fetch: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(response), { status: 200 });
    },
  });
  return { answer, bodies };
}

describe('benchmark shim structured output', () => {
  it('passes strict OpenAI schema and explicit effort, and prints the Claude result shape', async () => {
    const { answer, bodies } = await run(
      'gpt-6-luna',
      ['--json-schema', JSON.stringify(schema), '--reasoning-effort', 'high'],
      {
        choices: [{ message: { content: '{"value":4}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      },
    );
    expect(bodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'judge_answer', strict: true, schema },
    });
    expect(bodies[0].reasoning_effort).toBe('high');
    expect(answer).toMatchObject({
      type: 'result',
      subtype: 'success',
      result: '{"value":4}',
      is_error: false,
    });
    expect(answer.total_cost_usd).toBeCloseTo(0.000015);
  });

  it('converts Google nullability and lets the flag override the environment', async () => {
    const { bodies } = await run(
      'gemini-3.8-flash',
      ['--json-schema', JSON.stringify(schema), '--reasoning-effort', 'high'],
      {
        candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: '{"value":4}' }] } }],
      },
      { SHIM_GEMINI_THINKING: 'medium' },
    );
    expect(bodies[0].generationConfig).toEqual({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'high' },
      responseSchema: {
        type: 'object',
        properties: { value: { type: 'integer', nullable: true } },
        required: ['value'],
      },
    });
  });

  it('does not invent low effort or a response schema when neither is provided', async () => {
    const openai = await run('gpt-6-luna');
    const google = await run('gemini-3.8-flash');
    expect(openai.bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(openai.bodies[0]).not.toHaveProperty('response_format');
    expect(google.bodies[0]).not.toHaveProperty('generationConfig');
  });

  it('counts cached input and long-context multipliers in the published Luna price', async () => {
    const { answer } = await run('gpt-6-luna', [], {
      usage: {
        prompt_tokens: 300000,
        prompt_tokens_details: { cached_tokens: 100000 },
        completion_tokens: 1000,
      },
    });
    expect(answer.total_cost_usd).toBeCloseTo((200000 * 0.2 + 100000 * 0.02 + 1000 * 0.75) / 1e6);
  });

  it('rejects malformed schema before any provider call', async () => {
    const { answer, bodies } = await run('gpt-6-luna', ['--json-schema', 'not json']);
    expect(bodies).toHaveLength(0);
    expect(answer.is_error).toBe(true);
  });

  it('sets a fresh 180-second abort signal on every Gemini attempt', async () => {
    const { runShim } = await import(shimPath);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const signals: Array<AbortSignal | null | undefined> = [];
    try {
      await runShim({
        argv: ['--model', 'gemini-3.8-flash'],
        input: 'First.\nSecond.',
        env: {},
        fetch: async (_url: string, init: RequestInit) => {
          signals.push(init.signal);
          return signals.length === 1
            ? new Response('retry', { status: 503 })
            : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '4' }] } }] }));
        },
      });
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([180000, 180000]);
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
      expect(signals[0]).not.toBe(signals[1]);
    } finally {
      timeout.mockRestore();
    }
  });
});
