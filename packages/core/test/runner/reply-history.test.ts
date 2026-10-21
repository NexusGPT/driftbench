import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner/run';
import type { ResolvedGiven } from '../../src/schema/run';
import { specOf } from './support';

/** An agent that calls `lookup` on "open", and records the Given each session starts from. */
function fake() {
  const starts: ResolvedGiven[] = [];
  const adapter = functionAdapter({
    create(given) {
      starts.push(given);
    },
    respond(messages) {
      const user = messages.at(-1)?.content ?? '';
      return {
        segments: [],
        text: `answered ${user}`,
        toolCalls:
          user === 'open' ? [{ id: 'lookup-1', label: 'lookup', input: {}, output: { ref: 'ACME-1' } }] : [],
        cost: {},
        latencyMs: 0,
      };
    },
  });
  return { adapter, starts };
}

const spec = specOf({
  id: 'reply-history',
  blocks: [
    { id: 'root', when: { user: 'open' } },
    { id: 'child', parent: 'root', when: { user: 'child' } },
  ],
});

/** The assistant reply of the parent block, as the child block's session starts from it. */
async function parentReply(toolPolicy?: Array<{ pattern: string; action: 'deny' }>) {
  const { adapter, starts } = fake();
  await runSpec(spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'F',
    repeat: 0,
    ...(toolPolicy ? { toolPolicy } : {}),
  });
  const child = starts.find((given) => given.prefix.some((message) => message.content === 'answered open'));
  return child?.prefix.find((message) => message.role === 'assistant');
}

describe("the run's history keeps the reply the block was scored on", () => {
  it('holds the call and its output without a tool policy', async () => {
    expect(await parentReply()).toEqual({
      role: 'assistant',
      content: 'answered open',
      tool_calls: [{ label: 'lookup', id: 'lookup-1', input: {}, output: { ref: 'ACME-1' } }],
    });
  });

  it('holds the denied call, not the session reply, under a deny rule', async () => {
    expect(await parentReply([{ pattern: 'lookup', action: 'deny' }])).toEqual({
      role: 'assistant',
      content: 'answered open',
      tool_calls: [
        { label: 'lookup', id: 'lookup-1', input: {}, error: 'denied by tool policy rule lookup' },
      ],
    });
  });
});
