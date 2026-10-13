import { describe, expect, it } from 'vitest';
import type { ClientOptions } from '../src/client';
import { createAnthropicJudge, createGoogleJudge, createOpenAiJudge } from '../src/clients/chat';
import { createClaudeCliJudge } from '../src/clients/claude-cli';
import { googleResponseSchema, JUDGE_DIALECTS, withJudgeDialect } from '../src/clients/dialects';
import { createHttpJudge } from '../src/clients/http-json';
import { createJevJudge } from '../src/clients/system1';
import type { JudgeRequest } from '../src/contract';

const REQUEST: JudgeRequest = {
  answerContract: 'ledger',
  assessment: { kind: 'pairwise', items: [{ name: 'correct', rubric: 'Correct answer.' }] },
  criterion: { name: 'correct', rubric: 'Correct answer.' },
  candidates: { A: 'Four.', B: 'Five.' },
  transcript: [{ role: 'user', text: 'What is two plus two?' }],
};
const LEDGER = JSON.stringify({
  items: [{ name: 'correct', first: 4, second: 0, reasoning: 'Two plus two is four.', evidence: null }],
});
// biome-ignore lint/suspicious/noExplicitAny: mocked provider bodies intentionally have different shapes
type Body = any;
function mock(payload: unknown) {
  const bodies: Body[] = [];
  const options: ClientOptions = {
    env: { OPENAI_API_KEY: 'test', GEMINI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test' },
    model: 'test-model',
    maxRetries: 0,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  };
  return { options, bodies };
}

describe('pair-ledger client dialects', () => {
  it('keeps strict schema and reasoning when OpenAI retries without temperature', async () => {
    const bodies: Body[] = [];
    const client = createOpenAiJudge({
      model: 'test-model',
      env: { OPENAI_API_KEY: 'test' },
      reasoning: 'medium',
      maxRetries: 0,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        return 'temperature' in body
          ? new Response(JSON.stringify({ error: { message: 'Unsupported temperature' } }), { status: 400 })
          : new Response(JSON.stringify({ choices: [{ message: { content: LEDGER } }] }), { status: 200 });
      },
    });
    for (let i = 0; i < 2; i++) {
      const result = await client.judge({ ...REQUEST, reasoning: 'high' });
      expect(result.pairLedger?.items[0]).toMatchObject({ first: 4, second: 0 });
    }
    expect(bodies.map((body) => 'temperature' in body)).toEqual([true, false, false]);
    for (const body of bodies) {
      expect(body.reasoning_effort).toBe('high');
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.response_format).toEqual(bodies[0].response_format);
      expect(body.messages).toEqual(bodies[0].messages);
    }
  });

  it('OpenAI uses strict ledger schema, its dialect, and a request reasoning override', async () => {
    const { options, bodies } = mock({ choices: [{ message: { content: LEDGER } }] });
    const client = createOpenAiJudge({ ...options, reasoning: 'medium' });
    await client.judge({ ...REQUEST, reasoning: 'high' });
    expect(client.dialect).toBe('openai-json-schema');
    expect(client.reasoning).toBe('medium');
    expect(bodies[0].reasoning_effort).toBe('high');
    expect(bodies[0].response_format.json_schema.strict).toBe(true);
    expect(bodies[0].response_format.json_schema.schema.properties.items).toBeDefined();
    expect(JSON.stringify(bodies[0].messages)).not.toContain('Think first in plain text.');
  });

  it('OpenAI passes client reasoning only when set and does not invent low', async () => {
    const { options, bodies } = mock({ choices: [{ message: { content: LEDGER } }] });
    await createOpenAiJudge({ ...options, reasoning: 'medium' }).judge(REQUEST);
    await createOpenAiJudge(options).judge(REQUEST);
    expect(bodies[0].reasoning_effort).toBe('medium');
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
  });

  it('Google uses scalar nullable schema and passes the chosen thinking level', async () => {
    const { options, bodies } = mock({ candidates: [{ content: { parts: [{ text: LEDGER }] } }] });
    const client = createGoogleJudge({ ...options, reasoning: 'medium' });
    await client.judge({ ...REQUEST, reasoning: 'high' });
    expect(client.dialect).toBe('google-response-schema');
    const config = bodies[0].generationConfig;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'high' });
    const row = config.responseSchema.properties.items.items;
    expect(row.properties.first).toMatchObject({ type: 'integer', nullable: true });
    expect(row.properties.first).not.toHaveProperty('anyOf');
    expect(row.properties.second).toMatchObject({ type: 'integer', nullable: true });
    expect(row.properties.evidence).toMatchObject({ type: 'string', nullable: true });
    expect(JSON.stringify(config.responseSchema)).not.toContain('additionalProperties');
  });

  it('Google falls back to client reasoning but omits an unset thinking configuration', async () => {
    const { options, bodies } = mock({});
    await createGoogleJudge({ ...options, reasoning: 'medium' }).judge(REQUEST);
    await createGoogleJudge(options).judge(REQUEST);
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
    expect(bodies[1].generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('Anthropic sends the scratchpad dialect and parses the final ledger', async () => {
    const { options, bodies } = mock({ content: [{ type: 'text', text: `Read both.\n${LEDGER}` }] });
    const client = createAnthropicJudge(options);
    const answer = await client.judge(REQUEST);
    expect(client.dialect).toBe('scratchpad-json');
    expect(bodies[0].messages[0].content).toContain('Think first in plain text.');
    expect(answer.unparsed).toBeUndefined();
  });

  it('generic HTTP sends the dialect and reasoning as request fields and accepts JSON text', async () => {
    const { options, bodies } = mock(`Read both.\n${LEDGER}`);
    const client = createHttpJudge({
      ...options,
      url: 'https://example.test',
      family: 'test',
      reasoning: 'high',
    });
    const answer = await client.judge(REQUEST);
    expect(client.dialect).toBe('scratchpad-json');
    expect(bodies[0].request).toMatchObject({ dialect: 'scratchpad-json', reasoning: 'high' });
    expect(bodies[0].prompt.user).toContain('Think first in plain text.');
    expect(answer.unparsed).toBeUndefined();
  });

  it('Claude CLI selects scratchpad before building the prompt and reads its final object', async () => {
    const script = `
      let input = '';
      process.stdin.on('data', chunk => { input += chunk; });
      process.stdin.on('end', () => {
        const system = process.argv[process.argv.indexOf('--system-prompt') + 1];
        const ledger = { items: [{ name: 'correct', first: 4, second: 0, reasoning: system + input, evidence: null }] };
        process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'Scratchpad.\\n' + JSON.stringify(ledger) }));
      });
    `;
    const client = createClaudeCliJudge({
      model: 'test',
      env: {},
      command: process.execPath,
      commandArgs: ['--eval', script, '--'],
    });
    const result = await client.judge(REQUEST);
    expect(client.dialect).toBe('scratchpad-json');
    expect(result.unparsed).toBeUndefined();
    expect(result.raw).toContain('Think first in plain text.');
  });

  it('keeps legacy payloads free of ledger dialect and strict schema changes', async () => {
    const { options, bodies } = mock({});
    const legacy = { ...REQUEST, answerContract: 'legacy' as const };
    await createOpenAiJudge(options).judge(legacy);
    await createGoogleJudge(options).judge(legacy);
    await createHttpJudge({ ...options, url: 'https://example.test', family: 'test' }).judge(legacy);
    expect(bodies[0].response_format.json_schema.strict).toBe(false);
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1].generationConfig).not.toHaveProperty('thinkingConfig');
    expect(bodies[2].request).toEqual(legacy);
  });

  it('System 1 declares probability output and never sends a ledger answer request', async () => {
    const { options, bodies } = mock({ answers: { verdict: { noul: 0.9 } } });
    const client = createJevJudge({
      ...options,
      env: { JEV_URL: 'https://example.test', JEV_API_KEY: 'test' },
    });
    await client.judge(REQUEST);
    expect(client.dialect).toBe('system1-probability');
    expect(bodies[0].questions.verdict.type).toBe('noul');
    expect(bodies[0].state.data).not.toContain('Think first in plain text.');
  });
});

describe('Google nullable schema conversion', () => {
  it('handles type arrays and anyOf null recursively without mutating input', async () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: ['integer', 'null'], minimum: 0 },
        b: { anyOf: [{ type: 'string', enum: ['x'] }, { type: 'null' }] },
        c: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
      },
    };
    const before = JSON.stringify(schema);
    expect(googleResponseSchema(schema)).toEqual({
      type: 'object',
      properties: {
        a: { type: 'integer', minimum: 0, nullable: true },
        b: { type: 'string', enum: ['x'], nullable: true },
        c: { type: 'array', items: { type: 'number', nullable: true } },
      },
    });
    expect(JSON.stringify(schema)).toBe(before);
  });

  it('rejects a type union it cannot convert without losing meaning', () => {
    expect(() => googleResponseSchema({ type: ['string', 'integer', 'null'] })).toThrow(/one non-null type/);
  });
});

describe('the published dialect table', () => {
  it('describes every transport and exposes no reasoning default', () => {
    expect(Object.keys(JUDGE_DIALECTS).sort()).toEqual([
      'anthropic',
      'claude-cli',
      'google',
      'http',
      'jev',
      'openai',
      'openai-decisions',
    ]);
    expect(JUDGE_DIALECTS.openai).toMatchObject({ id: 'openai-json-schema', strict: true });
    expect(JUDGE_DIALECTS.google).toMatchObject({ id: 'google-response-schema', nullable: true });
    expect(JSON.stringify(JUDGE_DIALECTS)).not.toContain('low');
  });

  it('selects the transport dialect without mutating a request or opting in legacy calls', () => {
    const ledger: JudgeRequest = { ...REQUEST, dialect: 'wrong', reasoning: 'high' };
    const updated = withJudgeDialect(ledger, 'openai-json-schema', 'medium');
    expect(updated).toMatchObject({ dialect: 'openai-json-schema', reasoning: 'high' });
    expect(ledger.dialect).toBe('wrong');
    const legacy = { ...REQUEST, answerContract: 'legacy' as const };
    expect(withJudgeDialect(legacy, 'openai-json-schema', 'high')).toBe(legacy);
  });
});
