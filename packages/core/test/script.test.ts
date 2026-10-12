import { describe, expect, it } from 'vitest';
import {
  agent,
  conversation,
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
    expect(() => proceed()).toThrow(/simulated user/);
    expect(() => succeed()).toThrow(/no early-stop step/);
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
