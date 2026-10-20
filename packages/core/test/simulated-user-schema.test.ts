import { describe, expect, it } from 'vitest';
import { parseSpecText, specHash, validateSpec } from '../src/index';

const user = {
  mode: 'simulated',
  goal: 'Move to a plan with more data.',
  hidden_knowledge: { email: 'sam.rivera@example.com' },
  reveal: { email: 'on_request' },
  ask_patterns: { email: ['e-?mail'] },
  stop: '###STOP###',
  trials: 4,
};

describe('when.simulated_user', () => {
  it('loads on a user stimulus, in the when form, from YAML as from an object', () => {
    const long = validateSpec({ id: 's', blocks: [{ when: { user: 'Hi', simulated_user: user } }] });
    expect(long.ok).toBe(true);
    const yaml = parseSpecText(
      [
        'id: s',
        'blocks:',
        '  - when:',
        '      user: Hi',
        '      simulated_user:',
        '        mode: simulated',
        '        goal: Move to a plan with more data.',
        '        hidden_knowledge: { email: sam.rivera@example.com }',
        '        reveal: { email: on_request }',
        "        ask_patterns: { email: ['e-?mail'] }",
        "        stop: '###STOP###'",
        '        trials: 4',
        '',
      ].join('\n'),
      'yaml',
    );
    expect(yaml.ok).toBe(true);
    if (!long.ok || !yaml.ok) return;
    expect(yaml.spec.blocks[0]?.when).toEqual(long.spec.blocks[0]?.when);
    expect(yaml.hash).toBe(long.hash);
  });

  it('is a key of the stimulus, not of the block: a block-level simulated_user is refused', () => {
    expect(validateSpec({ id: 's', blocks: [{ user: 'Hi', simulated_user: { mode: 'exact' } }] }).ok).toBe(
      false,
    );
  });

  it('enters the spec hash only when present', () => {
    const plain = validateSpec({ id: 's', blocks: [{ user: 'Hi' }] });
    const exact = validateSpec({
      id: 's',
      blocks: [{ when: { user: 'Hi', simulated_user: { mode: 'exact' } } }],
    });
    expect(plain.ok && exact.ok).toBe(true);
    if (!plain.ok || !exact.ok) return;
    expect('simulated_user' in (plain.spec.blocks[0]?.when ?? {})).toBe(false);
    expect(specHash(exact.spec)).not.toBe(specHash(plain.spec));
  });

  it('refuses a reveal or ask pattern for a fact the user does not hold, and shares that do not sum to 1', () => {
    const unknown = validateSpec({
      id: 's',
      blocks: [{ when: { user: 'Hi', simulated_user: { ...user, reveal: { phone: 'on_request' } } } }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(JSON.stringify(unknown.errors)).toContain(
        'reveal names phone, which is not in hidden_knowledge',
      );
    const shares = validateSpec({
      id: 's',
      blocks: [{ when: { user: 'Hi', simulated_user: { ...user, engine: { acts_per_turn: [0.5, 0.2] } } } }],
    });
    expect(shares.ok).toBe(false);
    if (!shares.ok) expect(JSON.stringify(shares.errors)).toContain('acts_per_turn must sum to 1');
  });

  it('refuses an unknown mode, a malformed recorded hash and a simulated user on a burst', () => {
    for (const bad of [
      { user: 'Hi', simulated_user: { mode: 'free' } },
      { user: 'Hi', simulated_user: { mode: 'replay', recorded: { hash: 'abc' } } },
      { burst: ['a', 'b'], simulated_user: { mode: 'exact' } },
    ]) {
      expect(validateSpec({ id: 's', blocks: [{ when: bad }] }).ok).toBe(false);
    }
  });
});
