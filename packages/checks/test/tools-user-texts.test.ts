import { type Message, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createToolsCheck, replayInputValues } from '../src/checks/tools';
import { DEFAULT_VALUE_POLICY } from '../src/value-check/ladder';
import { context, GIVEN, observed, run } from './support/context';

/**
 * What the user wrote is read by one rung only (the value was given by the user), so the tools check collects it
 * when a rung asks and once for the block. A block whose values equal the gold must not walk the history: that
 * walk is work per block that grows with the run, quadratic over a long run.
 */

/** A history that counts the passes made over it: `filter` is how the check collects the user turns. */
function countedHistory(turns: number): { prefix: Message[]; passes: () => number } {
  const prefix: Message[] = Array.from({ length: turns }, (_, at) => ({
    role: at % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${at}`,
  }));
  let passes = 0;
  const filter = prefix.filter.bind(prefix);
  prefix.filter = ((...args: Parameters<Message[]['filter']>) => {
    passes += 1;
    return filter(...args);
  }) as Message[]['filter'];
  return { prefix, passes: () => passes };
}

function spec() {
  const parsed = validateSpec({
    id: 'user-texts',
    blocks: [
      {
        user: 'Call me on +12025550131',
        expect: { tools: [{ label: 'notify_sales', input: { phone: '+12025550131', note: 'call back' } }] },
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.spec;
}

describe('the tools check collects the user texts only when a rung reads them', () => {
  it('walks no history when every value equals the gold', async () => {
    const { prefix, passes } = countedHistory(400);
    const seen = observed('Done', [
      { label: 'notify_sales', input: { phone: '+12025550131', note: 'call back' } },
    ]);
    await run(createToolsCheck(), context(spec(), 0, seen, { given: { ...GIVEN, prefix } }));
    expect(passes()).toBe(0);
  });

  it('walks it once for the block when values differ, however many arguments are decided', async () => {
    const { prefix, passes } = countedHistory(400);
    const seen = observed('Done', [
      { label: 'notify_sales', input: { phone: '+1 202 555 0131', note: 'Call back' } },
    ]);
    await run(createToolsCheck(), context(spec(), 0, seen, { given: { ...GIVEN, prefix } }));
    expect(passes()).toBe(1);
  });
});

describe('a replay of one input verdict reads the user texts when a rung asks', () => {
  it('finds the value the user gave and fails the agent that changed it', async () => {
    const parsed = validateSpec({
      id: 'user-texts-replay',
      blocks: [
        {
          user: 'Reach me at sam.rivera@example.com',
          expect: { tools: [{ label: 'notify_sales', input: { email: 'sam.rivera@example.com' } }] },
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const seen = observed('Done', [{ label: 'notify_sales', input: { email: 'Sam.Rivera@example.com' } }]);
    const replayed = await replayInputValues(
      context(parsed.spec, 0, seen),
      'tools.notify_sales.input.email',
      DEFAULT_VALUE_POLICY,
      {},
    );
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.leaves[0]?.result).toMatchObject({ outcome: 'fail', rung: 'rung2b_as_given' });
  });
});
