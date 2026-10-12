import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traceFromClaudeCode } from '../../src/traces/claude-code';

const SESSION = fileURLToPath(new URL('./sessions/claude-code-subagent.jsonl', import.meta.url));
const PRICES = { 'example-model-1': { input: 2, output: 8 } };

describe('traceFromClaudeCode keeps the transcript tree as observations', () => {
  it('nests subagent lines under the line that started them, and marks them', async () => {
    const trace = await traceFromClaudeCode(SESSION);
    const observations = trace.observations ?? [];
    expect(observations).toHaveLength(6);
    const byId = new Map(observations.map((entry) => [entry.id, entry]));
    expect(byId.get('sub-s1')).toMatchObject({ parentId: 'sub-a1', subagent: true, kind: 'other' });
    expect(byId.get('sub-s2')).toMatchObject({ parentId: 'sub-s1', subagent: true, kind: 'chat' });
    expect(byId.get('sub-a1')?.subagent).toBeUndefined();
    expect(byId.get('sub-u2')).toMatchObject({ kind: 'tool', level: 'default', parentId: 'sub-a1' });
  });

  it('gives a chat line its usage and, with a price table, its cost', async () => {
    const trace = await traceFromClaudeCode(SESSION, { prices: PRICES });
    const chat = trace.observations?.find((entry) => entry.id === 'sub-a1');
    expect(chat).toMatchObject({
      kind: 'chat',
      level: 'default',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(chat?.usd).toBeCloseTo((120 * 2) / 1e6 + (30 * 8) / 1e6, 12);
  });

  it('gives no cost without a price table, and leaves the trace itself unchanged', async () => {
    const trace = await traceFromClaudeCode(SESSION);
    expect(trace.observations?.find((entry) => entry.id === 'sub-a1')?.usd).toBeUndefined();
    expect(trace.turns.length).toBe(1);
  });
});

describe('traceFromClaudeCode turns start from the transcript line they came from', () => {
  it('gives each turn the uuid of the user line it starts from', async () => {
    const trace = await traceFromClaudeCode(SESSION);
    expect(trace.turns.map((turn) => turn.observationId)).toEqual(['sub-u1']);
  });
});
