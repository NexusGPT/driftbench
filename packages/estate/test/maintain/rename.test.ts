import { describe, expect, it } from 'vitest';
import { diffEstateMaps, estateImpact, renderEstateDiff } from '../../src/index';
import { atom, estateMap } from './support';

/** A bakery estate whose dough skill moves to a new folder; its `name` stays `dough-plan`. */
function bakery(folder: string, helperFile = '.claude/agents/oven-check.md') {
  const file = `.claude/skills/${folder}/SKILL.md`;
  return estateMap([
    atom('route.standing.dough', 'Plan dough: dough-plan', {
      kind: 'route',
      line: 3,
      fields: { target: 'dough-plan', targetKind: 'skill' },
    }),
    atom(`skill.${folder}.skill-dough-plan`, 'name: dough-plan', {
      kind: 'skill',
      file,
      line: 2,
      fields: { name: 'dough-plan' },
    }),
    atom(`instruction.${folder}.weigh-the-flour`, 'Weigh the flour before mixing.', { file, line: 6 }),
    atom(`reference.${folder}.read-hydration`, 'Read `references/hydration.md`.', {
      kind: 'reference',
      file,
      line: 7,
      fields: { path: `.claude/skills/${folder}/references/hydration.md` },
    }),
    atom('subagent.oven-check.helper', 'name: oven-check', {
      kind: 'subagent',
      file: helperFile,
      line: 2,
      fields: { name: 'oven-check' },
    }),
    atom('instruction.oven-check.never-open', 'Never open the oven early.', { file: helperFile, line: 5 }),
  ]);
}

const tests = [
  { id: 't-weigh', path: 'a.yaml', file: 'a.yaml', atoms: ['instruction.dough-plan.weigh-the-flour'] },
  { id: 't-read', path: 'b.yaml', file: 'b.yaml', atoms: ['reference.dough-plan.read-hydration'] },
  { id: 't-route', path: 'c.yaml', file: 'c.yaml', atoms: ['route.standing.dough'] },
];

describe('a skill or helper renamed with its name kept', () => {
  it('pairs the atoms of the renamed folder and retires nothing', () => {
    const diff = diffEstateMaps(bakery('dough-plan'), bakery('dough-plan-2026'));
    expect(diff.atoms.removed).toEqual([]);
    expect(diff.atoms.added).toEqual([]);
    expect((diff.atoms.renamed ?? []).map((entry) => [entry.from, entry.to])).toEqual([
      ['skill.dough-plan.skill-dough-plan', 'skill.dough-plan-2026.skill-dough-plan'],
      ['instruction.dough-plan.weigh-the-flour', 'instruction.dough-plan-2026.weigh-the-flour'],
      ['reference.dough-plan.read-hydration', 'reference.dough-plan-2026.read-hydration'],
    ]);
    expect(renderEstateDiff(diff)).toContain('Renamed with their skill or helper, name kept:');
    const impact = estateImpact(diff, tests);
    expect(impact.retire).toEqual([]);
    expect(impact.new).toEqual([]);
    expect(impact.regenerate.map((entry) => [entry.test, entry.atoms[0]?.why])).toEqual([
      ['t-weigh', 'renamed'],
      ['t-read', 'renamed'],
    ]);
  });

  it('follows a helper file renamed with its name kept', () => {
    const diff = diffEstateMaps(bakery('dough-plan'), bakery('dough-plan', '.claude/agents/ovens/oven-check.md'));
    // The ids of a helper do not carry its file, so nothing is added or removed at all.
    expect(diff.summary.added + diff.summary.removed).toBe(0);
  });

  it('keeps a removal a removal when the name changed with the folder', () => {
    const before = bakery('dough-plan');
    const after = bakery('bread-plan');
    const unit = after.atoms.find((entry) => entry.kind === 'skill');
    if (unit) unit.fields = { name: 'bread-plan' };
    const diff = diffEstateMaps(before, estateMap(after.atoms));
    expect(diff.atoms.renamed ?? []).toEqual([]);
    expect(diff.atoms.removed.map((entry) => entry.id)).toContain('instruction.dough-plan.weigh-the-flour');
    const impact = estateImpact(diff, tests);
    expect(impact.retire.map((entry) => entry.test)).toEqual(['t-weigh', 't-read']);
  });
});
