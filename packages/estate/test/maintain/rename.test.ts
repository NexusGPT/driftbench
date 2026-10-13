import { describe, expect, it } from 'vitest';
import { diffEstateMaps, estateImpact } from '../../src/index';
import { atom, estateMap } from './support';

function skill(folder: string, name = 'menu-review') {
  const file = `.claude/skills/${folder}/SKILL.md`;
  return [
    atom(`skill.${folder}.skill-${name}`, `name: ${name}`, { kind: 'skill', file, fields: { name } }),
    atom(`instruction.${folder}.keep-prices`, 'Keep prices unchanged.', { file, line: 8 }),
    atom(`reference.${folder}.menu-format`, 'Read references/menu-format.md.', {
      kind: 'reference',
      file,
      line: 9,
      fields: { path: `.claude/skills/${folder}/references/menu-format.md` },
    }),
  ];
}

describe('a skill folder rename', () => {
  it('preserves its atoms and tests by the unique declared skill name', () => {
    const before = skill('menu-review');
    const after = skill('menu-review-v2');
    const diff = diffEstateMaps(estateMap(before), estateMap(after));
    expect(diff.atoms.removed).toEqual([]);
    expect(diff.atoms.added).toEqual([]);
    expect(diff.atoms.moved.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
    const tests = before.map((entry) => ({
      id: `test-${entry.id}`,
      path: 'test.yaml',
      file: 'test.yaml',
      atoms: [entry.id],
    }));
    const impact = estateImpact(diff, tests);
    expect(impact.retire).toEqual([]);
    expect(impact.new).toEqual([]);
  });

  it('keeps edge identity and regenerates tests that still name the old ids', () => {
    const before = skill('menu-review');
    const after = skill('menu-review-v2');
    const edge = (atoms: ReturnType<typeof skill>) => [
      { from: atoms[0]?.id ?? '', to: atoms[2]?.id ?? '', kind: 'reference' as const },
    ];
    const diff = diffEstateMaps(estateMap(before, edge(before)), estateMap(after, edge(after)));
    expect(diff.edges).toEqual({ added: [], removed: [] });
    expect(diff.atoms.restated.every((entry) => entry.fields.includes('id'))).toBe(true);
    expect(diff.atoms.restated).toHaveLength(3);
  });

  it('does not identify unrelated skills by equal body text', () => {
    const diff = diffEstateMaps(
      estateMap(skill('menu-review')),
      estateMap(skill('stock-check', 'stock-check')),
    );
    expect(diff.atoms.removed).toHaveLength(3);
    expect(diff.atoms.added).toHaveLength(3);
  });

  it('refuses ambiguous duplicate skill names', () => {
    const diff = diffEstateMaps(
      estateMap(skill('menu-review')),
      estateMap([...skill('menu-a'), ...skill('menu-b')]),
    );
    expect(diff.atoms.removed).toHaveLength(3);
    expect(diff.atoms.added).toHaveLength(6);
  });
});
