import {
  type AgentAdapter,
  injectingDriver,
  runSpec,
  type Spec,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { groundedValues } from '../src/checks/estate';

/**
 * grounded_values counts a value as seen when the agent received it. In mode P an injected turn shifts the
 * runtime block index past the spec index, so the seen text cannot be read from the spec's blocks by
 * position: it is built from the user turns the run actually sent.
 */
it('after a P insertion, a value only in the authored current block was never seen', async () => {
  const spec: Spec = {
    id: 'estate-sent-turns',
    kind: 'conversation',
    blocks: [
      { when: { user: 'Hello' }, expect: {} },
      { when: { user: 'Inspect invoice INV-7491.' }, expect: {} },
    ],
    perturbations: [
      {
        id: 'aside',
        class: 'D2_goal_shift',
        inject_at: 1,
        user: 'One unrelated aside.',
        expect: {},
        recovery: { within_blocks: 1 },
      },
    ],
  };
  const base = createScriptedDriver();
  const rewrite: UserDriver = {
    id: 'rewrite',
    async next(ctx) {
      const step = await base.next(ctx);
      return step.kind === 'block' && step.blockIndex === 1
        ? { ...step, stimulus: { user: 'Inspect invoice INV-8625.' } }
        : step;
    },
  };
  const received: unknown[] = [];
  const adapter: AgentAdapter = {
    id: 'review-agent',
    version: '1',
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: false,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: true,
    }),
    async open(given) {
      return {
        id: 's',
        adapter: 'review-agent',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
      };
    },
    async send(_session, turn) {
      received.push(turn.stimulus);
      const asked = 'user' in turn.stimulus ? turn.stimulus.user : '';
      const text = asked.includes('INV-8625') ? 'Invoice INV-7491 is ready.' : 'ok';
      return { text, segments: [{ type: 'text', text }], toolCalls: [], cost: { usd: 0 }, latencyMs: 0 };
    },
    async close() {},
  };
  const contexts: unknown[] = [];
  const run = await runSpec(spec, {
    adapter,
    driver: injectingDriver(rewrite, 'aside'),
    mode: 'P',
    repeat: 0,
    checks: [
      {
        name: 'grounded',
        applies: () => true,
        async evaluate(ctx) {
          contexts.push({ index: ctx.blockIndex, authored: ctx.block.when, sent: ctx.stimulus });
          return [await groundedValues(ctx, {})].flat();
        },
      },
    ],
  });
  expect(run.status, run.error).toBe('completed');
  expect(received).toEqual([
    { user: 'Hello' },
    { user: 'One unrelated aside.' },
    { user: 'Inspect invoice INV-8625.' },
  ]);
  expect(run.blocks[2]?.verdicts[0], JSON.stringify(contexts)).toMatchObject({ outcome: 'fail' });
});
