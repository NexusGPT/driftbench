import { describe, expect, it } from 'vitest';
import { createGoogleJudge } from '../src/index';

describe('the Google response schema', () => {
  it('holds no type list and no null type: Gemini takes one type and nullable', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createGoogleJudge({
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await judge.judge({ criterion: { name: 'c', rubric: 'r' }, transcript: [{ role: 'user', text: 'hi' }] });
    const config = (bodies[0]?.generationConfig ?? {}) as { responseSchema?: unknown };
    const schema = JSON.stringify(config.responseSchema);
    expect(schema).not.toMatch(/"type":\[/);
    expect(schema).not.toContain('"type":"null"');
    expect(schema).toContain('"nullable":true');
  });
});

type Schema = {
  properties?: { checks?: { items?: { properties?: Record<string, Record<string, unknown>> } } };
};

describe('googleSchema on nested nullable fields', () => {
  it('rewrites a nullable inside array items, at any depth', async () => {
    const bodies: Record<string, unknown>[] = [];
    const judge = createGoogleJudge({
      env: { GEMINI_API_KEY: 'k', GOOGLE_JUDGE_MODEL: 'm' },
      maxRetries: 0,
      fetch: async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await judge.judge({ criterion: { name: 'c', rubric: 'r' }, transcript: [{ role: 'user', text: 'hi' }] });
    const config = (bodies[0]?.generationConfig ?? {}) as { responseSchema?: Schema };
    const row = config.responseSchema?.properties?.checks?.items?.properties;
    expect(row?.met).toMatchObject({ type: 'boolean', nullable: true });
    expect(JSON.stringify(row?.evidence)).not.toContain('"type":"null"');
    expect(row?.evidence?.nullable).toBe(true);
  });
});
