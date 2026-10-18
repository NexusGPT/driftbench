import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traceFromClaudeCode } from '../../src/traces/claude-code';
import { rollUp } from '../../src/traces/rollup';

const SESSION = fileURLToPath(new URL('./sessions/claude-code-subagent.jsonl', import.meta.url));
const PRICES = { 'example-model-1': { input: 2, output: 8 } };

describe('rollUp: per subtree cost, tokens and latency, and the slowest path', () => {
  it('adds a line and everything under it, with its tokens, cost and the time it spans', async () => {
    const trace = await traceFromClaudeCode(SESSION, { prices: PRICES });
    const rollup = rollUp(trace.observations ?? []);
    const branch = rollup.totals.get('sub-a1');
    // The branch is sub-a1 with sub-s1, sub-s2, sub-u2 and sub-a2 under it.
    expect(branch?.inputTokens).toBe(120 + 80 + 200);
    expect(branch?.outputTokens).toBe(30 + 10 + 12);
    expect(branch?.usd).toBeCloseTo((400 * 2 + 52 * 8) / 1e6, 12);
    expect(branch?.latencyMs).toBe(4000);
    expect(branch?.spans).toBe(5);
  });

  it('gives a leaf its own totals and no children', async () => {
    const trace = await traceFromClaudeCode(SESSION, { prices: PRICES });
    const leaf = rollUp(trace.observations ?? []).totals.get('sub-a2');
    expect(leaf).toMatchObject({ inputTokens: 200, outputTokens: 12, spans: 1, latencyMs: 0 });
  });

  it('follows the child that finishes last from each root, which is the slowest path', async () => {
    const trace = await traceFromClaudeCode(SESSION, { prices: PRICES });
    expect(rollUp(trace.observations ?? []).slowestPath).toEqual(['sub-u1', 'sub-a1', 'sub-u2', 'sub-a2']);
  });
});
