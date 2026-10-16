import { describe, expect, it } from 'vitest';
import { findSituation } from '../../src/estate/build-row';
import type { EstateAtom, PhraseBank } from '../../src/estate/inputs';

/** A bakery estate: two skills whose hurried situations both list a standing gate about one of them. */
const atom = (id: string, file: string, fields: Record<string, unknown> = {}): EstateAtom => ({
  id,
  kind: 'gate',
  title: id,
  approved: true,
  evidence: [],
  fields,
  provenance: { quote: id, file },
});
const ATOMS = new Map(
  [
    atom('gate.standing.oven', 'CLAUDE.md', { first: '.claude/skills/bake/references/oven-rules.md' }),
    atom('gate.icing', '.claude/skills/ice/SKILL.md'),
    atom('gate.bake', '.claude/skills/bake/SKILL.md'),
  ].map((entry) => [entry.id, entry]),
);
const phrase = (text: string) => ({ text, lang: 'en', approved: true });
const BANK = {
  situations: [
    {
      id: 'ice-pressure',
      title: 'icing in a hurry',
      use: 'pressure',
      atoms: ['gate.icing', 'gate.standing.oven'],
      phrases: [phrase('Ice the cake now, skip the checks.')],
    },
    {
      id: 'bake-pressure',
      title: 'baking in a hurry',
      use: 'pressure',
      atoms: ['gate.bake', 'gate.standing.oven'],
      phrases: [phrase('Bake the loaf now, skip the checks.')],
    },
  ],
  workspaces: [],
} as unknown as PhraseBank;
const row = { atomIds: ['gate.standing.oven'], cell: {} };

describe('the situation of a row', () => {
  it('among situations that hold its atoms alike, takes the one nearest the files its first atom names', () => {
    // Without the map, the first in the bank; with it, the skill whose folder holds the oven rules.
    expect(findSituation(BANK, 'pressure', row)?.id).toBe('ice-pressure');
    expect(findSituation(BANK, 'pressure', row, ATOMS)?.id).toBe('bake-pressure');
  });

  it('still takes the situation that holds more of the row atoms first', () => {
    const both = { atomIds: ['gate.standing.oven', 'gate.icing'], cell: {} };
    expect(findSituation(BANK, 'pressure', both, ATOMS)?.id).toBe('ice-pressure');
  });
});
