import { expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const duty = (id: string, kind: 'instruction' | 'gate' = 'instruction'): EstateAtom => ({
  id,
  kind,
  title: 'A duty of the desk',
  approved: true,
  provenance: { file: 'DESK.md', quote: `Duty ${id}.` },
  fields: { ask: { text: `handle ${id}` } },
  evidence: [{ type: 'custom', name: 'prose_pointer' }],
});

const row = (atomIds: string[], extra: Partial<EstatePlanRow> = {}): EstatePlanRow => ({
  id: `obligation.${atomIds[0]}`,
  atomIds,
  cell: {},
  testType: 'obligation',
  mode: 'live',
  status: 'approved',
  ...extra,
});

function links(atoms: EstateAtom[], rows: EstatePlanRow[], situations: unknown[] = []) {
  const result = generateEstateSuite(
    {
      map: { runtime: 'claude-code', hash: 'desk', atoms },
      plan: { mapHash: 'desk', rows },
      bank: PhraseBank.parse({ version: 1, estate: 'desk', mapHash: 'desk', situations }),
    },
    { fallback: true, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
  const text = result.files.find((file) => file.path.endsWith('.yaml'))?.text ?? '';
  const found = [...text.matchAll(/rule: (\S+)[\s\S]*?relation: (\w+)/g)].map((m) => [m[1], m[2]]);
  return Object.fromEntries(found);
}

it('verifies the first atom of a row and only exercises the duties placed beside it', () => {
  const result = links([duty('a'), duty('b'), duty('c')], [row(['a', 'b', 'c'])]);
  expect(result).toMatchObject({ a: 'verifies', b: 'exercises', c: 'exercises' });
});

it('keeps a duty verified when the situation that supplies the ask names it', () => {
  const situation = {
    id: 'both',
    title: 'Both duties',
    use: 'trigger',
    atoms: ['a', 'b'],
    phrases: [{ text: 'Please sort the desk today.', lang: 'en', approved: true }],
  };
  const result = links([duty('a'), duty('b')], [row(['a', 'b'])], [situation]);
  expect(result).toMatchObject({ a: 'verifies', b: 'verifies' });
});

it('leaves a row of one atom, and the atoms of a journey, as they were', () => {
  expect(links([duty('a')], [row(['a'])])).toMatchObject({ a: 'verifies' });
  const journey = row(['a', 'b'], { id: 'journey.1', testType: 'journey' });
  expect(links([duty('a'), duty('b')], [journey])).toMatchObject({ a: 'verifies', b: 'verifies' });
});

it('adds no expectation of a duty placed beside the first atom to the block', () => {
  const gate: EstateAtom = { ...duty('g', 'gate'), evidence: [{ type: 'ordered', before: 'Read', after: 'Write' }] };
  const alone = textOf([duty('a')], [row(['a'])]);
  const grouped = textOf([duty('a'), gate], [row(['a', 'g'])]);
  expect(alone).not.toContain('ordered');
  expect(grouped).not.toContain('ordered');
});
