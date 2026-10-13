import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';

function ask(title: string, use: 'trigger' | 'forced', extra: Partial<EstateAtom> = {}) {
  const rule: EstateAtom = {
    id: 'instruction.sample.requirement',
    kind: 'instruction',
    title,
    approved: true,
    evidence: [],
    ...extra,
  };
  const guard: EstateAtom = {
    id: 'guard.sample.check',
    kind: 'guard',
    title: 'A guard',
    approved: true,
    evidence: [],
    fields: { enforces: [{ atom: rule.id }] },
  };
  return codeAsk(use, [guard], [], false, (id) => (id === rule.id ? rule : undefined));
}

describe('guard asks exercise a task that violates the enforced requirement', () => {
  it.each(['trigger', 'forced'] as const)('asks to edit without reading for %s', (use) => {
    expect(ask('Read a file before you edit it', use).text).toBe(
      'Please edit a file without reading it first.',
    );
  });

  it('derives the reply length from the declared predicate, not the guard identity', () => {
    expect(
      ask('Limit each reply', 'forced', {
        evidence: [{ type: 'custom', name: 'max_length', options: { characters: 240 } }],
      }).text,
    ).toBe('Please write a reply containing 241 characters.');
    expect(ask('Replies under 1,200 characters', 'forced').text).toBe(
      'Please write a reply containing 1201 characters.',
    );
  });

  it.each(['trigger', 'forced'] as const)('asks to run a script without its required input for %s', (use) => {
    expect(ask('Always pass the region code to the catalog script', use).text).toBe(
      'Please run the catalog script without passing the region code.',
    );
  });

  it('does not reinterpret a different reading order as editing the same file', () => {
    expect(ask('Read the policy before approving an order', 'forced').text).not.toBe(
      'Please edit a file without reading it first.',
    );
  });
});
