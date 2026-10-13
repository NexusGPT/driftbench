import { describe, expect, it } from 'vitest';
import {
  agent,
  conversation,
  fail,
  injection,
  judge,
  proceed,
  ScriptError,
  succeed,
  toYaml,
  user,
} from '../src/script';
import { parseSpecText } from '../src/spec/load';

const CRITERION = {
  name: 'refund.issued',
  rubric: 'The agent issues the refund only after it confirms the order.',
};

describe('the script API compiles to a spec', () => {
  it('turns user, agent and judge into blocks that the loader accepts', () => {
    const result = conversation(
      'refund-basic',
      [
        user('I want a refund for order 1234.', { must: ['refund'] }),
        agent({ must_not: ['refunded already'] }),
        judge(['refund.issued']),
        user('Thanks, bye.'),
      ],
      { criteria: [CRITERION] },
    );
    expect(result.load.ok).toBe(true);
    const blocks = result.spec.blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      id: 'b1',
      when: { user: 'I want a refund for order 1234.' },
      expect: { must: ['refund'], must_not: ['refunded already'], criteria: ['refund.issued'] },
    });
    expect(blocks[1]).toEqual({ id: 'b2', when: { user: 'Thanks, bye.' } });
    expect(result.spec.criteria).toEqual([CRITERION]);
    expect(result.spec.kind).toBe('conversation');
  });

  it('compiles an injection with its deviation class', () => {
    const result = conversation('deviate', [
      user('Where is my parcel?'),
      injection('D1_off_topic', 'is the shop open on Saturday?'),
    ]);
    expect(result.load.ok).toBe(true);
    const blocks = result.spec.blocks as Array<Record<string, unknown>>;
    expect(blocks[1]).toEqual({
      id: 'b2',
      when: { injection: { class: 'D1_off_topic', user: 'is the shop open on Saturday?' } },
    });
  });

  it('keeps repeated list expectations and refuses a scalar set twice in one block', () => {
    const merged = conversation('lists', [user('hello', { must: ['hi'] }), agent({ must: ['there'] })]);
    expect((merged.spec.blocks as Array<Record<string, unknown>>)[0]).toEqual({
      id: 'b1',
      when: { user: 'hello' },
      expect: { must: ['hi', 'there'] },
    });
    expect(() => conversation('twice', [user('hi', { lang: 'EN' }), agent({ lang: 'FR' })])).toThrow(
      ScriptError,
    );
  });

  it('refuses steps that have no meaning in a block order', () => {
    expect(() => conversation('orphan-agent', [agent({ must: ['x'] })])).toThrow(/after a user turn/);
    expect(() => conversation('orphan', [judge(['refund.issued'])])).toThrow(/after a user turn/);
  });

  it('refuses a judge with no criteria, because the spec has no final verdict step', () => {
    expect(() => judge([])).toThrow(ScriptError);
  });

  it('refuses the steps the spec cannot express, with the reason', () => {
    expect(() => proceed(0)).toThrow(/at least one turn/);
    expect(() => proceed(1.5)).toThrow(/whole number/);
    expect(() => (proceed as unknown as () => unknown)()).toThrow(/how many turns/);
    expect(succeed().kind).toBe('end');
  });

  it('reports a spec the loader rejects, as issues', () => {
    const result = conversation('bad-lang', [user('hi', { lang: 'x' })]);
    expect(result.load.ok).toBe(false);
  });

  it('writes YAML that parses back to the same spec', () => {
    const result = conversation('round-trip', [user('hi', { must: ['hello'] })], { lang: 'EN' });
    const text = toYaml(result.spec);
    const back = parseSpecText(text, 'yaml');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.spec.blocks).toHaveLength(1);
  });
});

describe('proceed reserves turns for the simulated user', () => {
  it('compiles n blocks that carry the hint, and names them in the metadata', () => {
    const result = conversation('reserved', [
      user('I need help with my order.'),
      proceed(2, { hint: 'Ask about the delivery date.', expect: { must_not: ['refund'] } }),
      user('Thanks, bye.'),
    ]);
    expect(result.load.ok).toBe(true);
    const blocks = result.spec.blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(4);
    expect(blocks[1]).toEqual({
      id: 'b2',
      when: { user: 'Ask about the delivery date.' },
      expect: { must_not: ['refund'] },
    });
    expect(blocks[2]?.when).toEqual({ user: 'Ask about the delivery date.' });
    expect(result.spec.metadata).toEqual({ simulated_blocks: [1, 2] });
  });

  it('uses a default hint when none is given, and leaves metadata out when nothing is reserved', () => {
    const reserved = conversation('default-hint', [proceed(1)]);
    expect((reserved.spec.blocks as Array<Record<string, unknown>>)[0]?.when).toEqual({
      user: 'Continue the conversation toward your goal.',
    });
    const plain = conversation('plain', [user('hi')]);
    expect(plain.spec.metadata).toBeUndefined();
  });
});

describe('succeed and fail end the script with a verdict', () => {
  it('succeed() as the last step compiles an end verdict of success, with its reason', () => {
    const result = conversation('ends-ok', [user('hi'), succeed('the order is placed')]);
    expect(result.load.ok).toBe(true);
    expect(result.spec.end).toEqual({ verdict: 'success', reason: 'the order is placed' });
    expect(result.spec.blocks).toHaveLength(1);
  });

  it('fail() as the last step compiles an end verdict of failure', () => {
    const result = conversation('ends-bad', [user('hi'), fail('the agent refused')]);
    expect(result.spec.end).toEqual({ verdict: 'failure', reason: 'the agent refused' });
  });

  it('succeed() in the middle ends the run there: the turns after it stay as blocks the verdict skips', () => {
    const result = conversation('mid', [user('one'), succeed('done'), user('two'), user('three')]);
    expect(result.load.ok).toBe(true);
    expect(result.spec.end).toEqual({ verdict: 'success', reason: 'done', atBlock: 0 });
    expect(result.spec.blocks).toHaveLength(3);
  });

  it('fail() before the last block records the block it stops after', () => {
    const result = conversation('mid-bad', [user('one'), user('two'), fail('refused'), user('three')]);
    expect(result.spec.end).toEqual({ verdict: 'failure', reason: 'refused', atBlock: 1 });
  });

  it('agent() or judge() after succeed() is refused: the block it checks would be skipped', () => {
    expect(() => conversation('late-agent', [user('one'), succeed(), agent({ must: ['x'] })])).toThrow(
      /skipped by the verdict/,
    );
  });

  it('a second succeed() or fail() is refused', () => {
    expect(() => conversation('twice', [user('one'), succeed(), user('two'), fail()])).toThrow(/not two/);
  });
});
