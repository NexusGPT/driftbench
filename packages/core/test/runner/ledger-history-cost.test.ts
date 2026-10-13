import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { runSpec } from '../../src/runner/run';
import type { Message } from '../../src/schema/common';
import { specOf } from './support';

it.each([40, 400])('does not collect irrelevant ledger history over %i blocks', async (blocks) => {
  const spec = specOf({
    id: 'ledger-history-cost',
    given: { ledger: { email: 'current@example.test' } },
    blocks: Array.from({ length: blocks }, (_, index) => ({ user: `message ${index}` })),
  });
  const filter = Array.prototype.filter;
  let visited = 0;
  Array.prototype.filter = function (
    predicate: (value: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    if ((this[0] as Message | undefined)?.role) visited += this.length;
    return filter.call(this, predicate, thisArg);
  };
  try {
    const run = await runSpec(spec, {
      adapter: functionAdapter({
        respond: () => ({ text: 'Acknowledged.', toolCalls: [], segments: [], cost: {}, latencyMs: 0 }),
      }),
      driver: createScriptedDriver(),
      checks: [],
      mode: 'T',
      repeat: 0,
    });
    expect(run.status, run.error).toBe('completed');
    expect(run.blocks).toHaveLength(blocks);
  } finally {
    Array.prototype.filter = filter;
  }
  expect(visited).toBe(0);
});
