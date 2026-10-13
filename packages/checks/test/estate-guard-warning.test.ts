import type { CheckContext, Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { guardMessage } from '../src/checks/estate';

async function run(verdict: string, output?: string) {
  const observed = {
    text: '',
    segments: [],
    toolCalls: [],
    cost: {},
    latencyMs: 0,
    runtime: {
      guards: [
        { name: 'reply-check.py', verdict, ...(output === undefined ? {} : { stdout: output, stderr: '' }) },
      ],
    },
  } as Observed;
  const results = await guardMessage({ blockIndex: 0, observed } as CheckContext, {
    name: 'reply-check.py',
    mustNot: ['forbidden-token'],
  });
  return Array.isArray(results) ? results : [results];
}

describe('warning guard output obeys the same message contract as blocking output', () => {
  it.each(['warn', 'nudge', 'ask'])(
    'accepts a %s message and rejects its prohibited text or empty output',
    async (verdict) => {
      expect((await run(verdict, 'Keep the reply short.')).map((v) => v.outcome)).toEqual(['pass', 'pass']);
      expect(
        (await run(verdict, 'forbidden-token')).find((v) => v.id === 'guard_message.rules')?.outcome,
      ).toBe('fail');
      expect((await run(verdict, ''))[0]?.outcome).toBe('fail');
      expect((await run(verdict))[0]).toMatchObject({ outcome: 'inconclusive', gating: true });
    },
  );
  it('does not treat an ordinary allow invocation as an intervention', async () => {
    expect((await run('allow', ''))[0]).toMatchObject({ outcome: 'inconclusive', gating: true });
  });
});
