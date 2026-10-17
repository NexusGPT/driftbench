import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { runSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { createSimulatedUser, type SimulatedUserOptions } from '../src/index';
import { block, spec } from './support';

/**
 * A simulated user on a spec whose blocks link by `parent`. Two trees: shop (root `shop`, child `shop-ask`)
 * and repair (root `repair`, child `repair-ask`). Each block reads only the blocks it follows.
 */
const TREES = spec({
  id: 'two-trees',
  blocks: [
    { id: 'shop', user: 'I need a quote for a bicycle.' },
    { id: 'shop-ask', parent: 'shop', user: 'Please go on.' },
    { id: 'repair', user: 'My bicycle chain is broken.' },
    { id: 'repair-ask', parent: 'repair', user: 'Please go on.' },
  ],
});

const EMAIL = 'noor.vandenberg@example.test';

/** The agent: asks for the e-mail address after the shop opening, says it needs nothing in the repair tree. */
const REPLIES: Record<string, string> = {
  'I need a bicycle quote.': 'Which e-mail address should I send it to?',
  'Any size will do.': 'A quote is on its way.',
  'My chain snapped.': 'Bring the bicycle to the workshop.',
  'Tuesday works.': 'Tuesday is booked.',
};

function adapter() {
  return functionAdapter({
    create: () => undefined,
    respond: (messages) => ({
      segments: [],
      text: REPLIES[messages.at(-1)?.content ?? ''] ?? 'Noted.',
      toolCalls: [],
      cost: {},
      latencyMs: 0,
    }),
  });
}

function user(answers: string[]) {
  const port = new FakeModelPort(answers, { family: 'mistral', model: 'fake-mistral' });
  const options: SimulatedUserOptions = {
    persona: 'A cyclist who writes short messages.',
    goal: 'Get a bicycle quote and a repair slot.',
    facts: { email: EMAIL },
    revealWhenAsked: { email: ['e-?mail'] },
    stopToken: '###STOP###',
    port,
    agentFamily: 'none',
    judgeFamilies: [],
  };
  return { port, driver: createSimulatedUser(options) };
}

const run = (answers: string[]) => {
  const made = user(answers);
  const result = runSpec(TREES, {
    adapter: adapter(),
    driver: made.driver,
    checks: [],
    mode: 'F',
    repeat: 0,
  });
  return { ...made, result };
};

const ANSWERS = ['I need a bicycle quote.', 'Any size will do.', 'My chain snapped.', 'Tuesday works.'];

describe('a simulated user on a spec with parent blocks', () => {
  it('shows the root of a second tree no conversation from the first', async () => {
    const { port, result } = run(ANSWERS);
    expect((await result).status).toBe('completed');
    const second = port.requests[2]?.user ?? '';
    expect(second).toContain('(nothing yet: you write first)');
    expect(second).not.toContain('Which e-mail address');
    expect(second).not.toContain('I need a bicycle quote.');
    expect(second.startsWith('Turn 1.')).toBe(true);
  });

  it('offers a fact only after an agent reply in its own branch asked for it', async () => {
    const { port, driver, result } = run(ANSWERS);
    await result;
    const offered = (index: number) => port.requests[index]?.user ?? '';
    // Asked in the shop tree: offered to its child, not to the repair tree.
    expect(offered(1)).toContain(`- email: ${EMAIL}`);
    expect(offered(2)).toContain('(none)');
    expect(offered(3)).toContain('(none)');
    expect(driver.revealed()).toEqual([]);
  });

  it('fails a leak in the second tree: the e-mail asked only in the first is not asked there', async () => {
    const leaked = [
      ANSWERS[0] as string,
      ANSWERS[1] as string,
      `My email is ${EMAIL}.`,
      ANSWERS[3] as string,
    ];
    const finished = await run(leaked).result;
    expect(finished.status).toBe('failed');
    expect(finished.error).toContain('gave email at block 2 before the agent asked for it');
  });

  it('keeps the messages of each block with that block, never with a position', async () => {
    const { port, result } = run(ANSWERS);
    await result;
    const lines = (index: number) =>
      (port.requests[index]?.user ?? '')
        .split('\n')
        .filter((line) => line.startsWith('Customer:') || line.startsWith('Assistant:'));
    expect(lines(1)).toEqual([
      'Customer: I need a bicycle quote.',
      'Assistant: Which e-mail address should I send it to?',
    ]);
    expect(lines(3)).toEqual([
      'Customer: My chain snapped.',
      'Assistant: Bring the bicycle to the workshop.',
    ]);
    expect((port.requests[3]?.user ?? '').startsWith('Turn 2.')).toBe(true);
  });

  it('finds the message of a block by the block, whatever place it holds in its branch', async () => {
    const { port, driver } = user([
      'Hello from the shop.',
      'More from the shop.',
      'Hello from the repair.',
      'Then Friday.',
    ]);
    const results = [
      block(0, { blockId: 'shop' }),
      block(1, { blockId: 'shop-ask', parent: 'shop' }),
      block(2, { blockId: 'repair' }),
    ];
    for (const [blockIndex, branch] of [
      [0, []],
      [1, results.slice(0, 1)],
      [2, []],
      [3, results.slice(2)],
    ] as const) {
      await driver.next({
        spec: TREES,
        mode: 'F',
        blockIndex,
        history: results.slice(0, blockIndex),
        branch,
      });
    }
    const last = port.requests[3]?.user ?? '';
    expect(last).toContain('Customer: Hello from the repair.');
    expect(last).not.toContain('Hello from the shop.');
  });

  it('reads a context written by hand without a branch as the whole history, as it always did', async () => {
    const { driver } = user(['Hello there.']);
    const step = await driver.next({
      spec: TREES,
      mode: 'F',
      blockIndex: 0,
      history: [block(0, { text: 'Which e-mail address?' })],
    });
    expect(step.kind).toBe('block');
    expect(driver.revealed()).toEqual(['email']);
  });
});
