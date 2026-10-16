import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { judgeReal, type Measured, realBudgetMs, realUnits } from '../../src/ladders/estate/bank/scale-real';
import { realEstate } from '../../src/ladders/estate/bank/scale-real-estate';
import { readFacts } from '../../src/ladders/estate/bank/scale-real-facts';

const RULE_WORDS = /\b(must|never|always|only when|before|first|requires)\b/i;

describe('the real-size estate', () => {
  it('has the shape of a large working estate at scale 1', () => {
    const { truth, files } = realEstate(1);
    expect(truth.files).toBeGreaterThan(6500);
    expect(truth.files).toBeLessThan(7200);
    expect(truth.markdown).toBe(766);
    expect(truth.proseBytes).toBeGreaterThan(10_000_000);
    expect(truth.standingBytes).toBeGreaterThan(140_000);
    expect(truth.standingBytes).toBeLessThan(160_000);
    expect(truth.skills).toHaveLength(64);
    expect(truth.skills.filter((skill) => skill.nested)).toHaveLength(16);
    expect(truth.helpers).toHaveLength(34);
    expect(truth.guards).toHaveLength(113);
    expect(Object.keys(files)).toHaveLength(truth.files);
  });

  it('plants every rule, gate and guard on the line the truth names, deep inside the standing file', () => {
    const { truth, files } = realEstate(2, { scale: 0.1 });
    for (const planted of [...truth.rules, ...truth.gates]) {
      const lines = (files[planted.file] as string).split('\n');
      expect(lines[planted.line - 1], `${planted.file}:${planted.line}`).toBe(planted.text);
      expect(planted.text.toLowerCase()).toContain(planted.core.toLowerCase().slice(0, 12));
    }
    const standing = truth.rules.filter((rule) => rule.file === 'CLAUDE.md');
    const total = (files['CLAUDE.md'] as string).split('\n').length;
    expect(standing.map((rule) => rule.form).sort()).toEqual(['always', 'must', 'never', 'only-when']);
    expect(Math.min(...standing.map((rule) => rule.line)) / total).toBeGreaterThan(0.02);
    expect(Math.max(...[...standing, ...truth.gates].map((rule) => rule.line)) / total).toBeGreaterThan(0.85);
    for (const guard of truth.guards) expect(files[guard.script]).toContain(guard.description);
  });

  it('writes filler with none of the words that make a rule, so a rule found in it is false', () => {
    const { files } = realEstate(3, { scale: 0.1 });
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith('docs/notes/') && !path.includes('/references/')) continue;
      expect(text, path).not.toMatch(RULE_WORDS);
    }
  });

  it('plants the documents that are not rules with rule-like and reference-like text in them', () => {
    const { files, truth } = realEstate(4, { scale: 0.1 });
    expect(truth.nonNormative.length).toBeGreaterThan(10);
    for (const path of truth.nonNormative) expect(files[path], path).toMatch(/never|before|always|<skill>/i);
  });

  it('is the same for the same seed and different for another', () => {
    expect(realEstate(5, { scale: 0.05 }).files).toEqual(realEstate(5, { scale: 0.05 }).files);
    expect(realEstate(5, { scale: 0.05 }).files).not.toEqual(realEstate(6, { scale: 0.05 }).files);
  });
});

/** The map a perfect reader would give for a planted estate: an atom for each thing the truth plants. */
function perfectMap(seed: number): { map: EstateMap; truth: ReturnType<typeof realEstate>['truth'] } {
  const { truth } = realEstate(seed, { scale: 0.1 });
  const atoms: Atom[] = [];
  const atom = (id: string, kind: string, file: string, line: number, quote: string, fields = {}): Atom =>
    ({
      id,
      kind,
      title: quote.slice(0, 40),
      provenance: { file, startLine: line, endLine: line, quote, hash: id },
      producedBy: 'code',
      role: 'axis',
      approved: true,
      evidence: [{ type: 'custom', name: 'x' }],
      enforcement: [],
      fields,
    }) as Atom;
  for (const rule of truth.rules)
    atoms.push(atom(`rule.${rule.file}.${rule.line}`, 'instruction', rule.file, rule.line, rule.text));
  for (const gate of truth.gates)
    atoms.push(atom(`gate.${gate.line}`, 'gate', gate.file, gate.line, gate.text));
  const edges: EstateMap['edges'] = [];
  for (const skill of truth.skills) {
    const folder = skill.file.replace(/\/SKILL\.md$/, '');
    const skillAtom = atom(`skill.${skill.name}`, 'skill', skill.file, 2, `name: ${skill.name}`);
    atoms.push(skillAtom);
    const cited = skill.references.map((r) => `${folder}/${r}`).concat(skill.crossRefs);
    for (const path of cited) {
      const reference = atom(`reference.${skill.name}.${path}`, 'reference', skill.file, 9, `Open ${path}`, {
        path,
      });
      atoms.push(reference);
      edges.push({ from: skillAtom.id, to: reference.id, kind: 'reference' });
    }
  }
  for (const guard of truth.guards)
    atoms.push(
      atom(`guard.${guard.name}`, 'guard', '.claude/settings.json', 5, guard.description, {
        name: guard.name,
        script: guard.script,
      }),
    );
  return { map: { atoms, edges } as unknown as EstateMap, truth };
}

describe('the facts read off a map against the planted truth', () => {
  it('finds everything a perfect map holds', () => {
    const { map, truth } = perfectMap(1);
    const facts = readFacts(map, truth);
    for (const [key, count] of Object.entries(facts.rules)) expect(count.found, key).toBe(count.planted);
    for (const [key, count] of Object.entries(facts.gates)) expect(count.found, key).toBe(count.planted);
    expect(facts.skills.found).toBe(facts.skills.planted);
    expect(facts.references.found).toBe(facts.references.planted);
    expect(facts.foreignReferences.edges).toBe(0);
    expect(facts.nonNormative.ruleAtoms).toBe(0);
    expect(facts.guards).toMatchObject({ resolved: truth.guards.length, described: truth.guards.length });
  });

  it('names a rule that is missing, on the wrong line or of the wrong kind', () => {
    const { map, truth } = perfectMap(1);
    const target = truth.rules.find((rule) => rule.file === 'CLAUDE.md' && rule.form === 'never');
    if (!target) throw new Error('no standing rule');
    const without = {
      ...map,
      atoms: map.atoms.filter(
        (a) => !(a.provenance.file === target.file && a.provenance.startLine === target.line),
      ),
    };
    expect(readFacts(without, truth).rules['standing-never']).toMatchObject({ planted: 1, found: 0 });
    const moved = {
      ...map,
      atoms: map.atoms.map((a) =>
        a.provenance.file === target.file && a.provenance.startLine === target.line
          ? { ...a, provenance: { ...a.provenance, startLine: target.line + 5, endLine: target.line + 5 } }
          : a,
      ),
    };
    expect(readFacts(moved, truth).rules['standing-never']?.found).toBe(0);
    const wrongKind = {
      ...map,
      atoms: map.atoms.map((a) =>
        a.provenance.file === target.file && a.provenance.startLine === target.line
          ? { ...a, kind: 'reference' as const }
          : a,
      ),
    };
    expect(readFacts(wrongKind, truth).rules['standing-never']?.found).toBe(0);
  });

  it('flags a skill whose references reach another skill, and a rule atom out of a changelog', () => {
    const { map, truth } = perfectMap(1);
    const [first, second] = truth.skills;
    if (!first || !second) throw new Error('need two skills');
    const stray = map.atoms.find((a) => a.id.startsWith(`reference.${second.name}.`));
    if (!stray) throw new Error('no reference');
    const flattened = {
      ...map,
      edges: [...map.edges, { from: `skill.${first.name}`, to: stray.id, kind: 'reference' as const }],
    };
    const foreign = readFacts(flattened, truth).foreignReferences;
    expect(foreign.edges).toBeGreaterThan(0);
    expect(foreign.skills).toBe(1);
    const changelog = {
      ...map,
      atoms: [
        ...map.atoms,
        {
          ...stray,
          id: 'rule.changelog',
          kind: 'instruction' as const,
          provenance: { ...stray.provenance, file: 'CHANGELOG.md' },
        },
      ],
    };
    expect(readFacts(changelog, truth).nonNormative.ruleAtoms).toBe(1);
  });

  it('counts a guard that names the dispatcher, or carries no description, as not resolved or not described', () => {
    const { map, truth } = perfectMap(1);
    const guard = truth.guards[0];
    if (!guard) throw new Error('no guard');
    const dispatcher = {
      ...map,
      atoms: map.atoms.map((a) =>
        a.id === `guard.${guard.name}`
          ? { ...a, fields: { ...a.fields, script: '.claude/hooks/run.py' } }
          : a,
      ),
    };
    expect(readFacts(dispatcher, truth).guards.resolved).toBe(truth.guards.length - 1);
    const bare = {
      ...map,
      atoms: map.atoms.map((a) =>
        a.id === `guard.${guard.name}`
          ? { ...a, provenance: { ...a.provenance, quote: 'x' }, title: 'x' }
          : a,
      ),
    };
    expect(readFacts(bare, truth).guards.described).toBe(truth.guards.length - 1);
  });
});

describe('the items of the real-size tier', () => {
  const emptyCount = { planted: 1, found: 1, missed: [] };
  const fine = (): Measured => ({
    files: 6845,
    proseBytes: 10_700_000,
    scanMs: 9000,
    lintMs: 5000,
    planMs: 20000,
    generateMs: 15000,
    impactMs: 100,
    lintOnDocuments: { findings: 0, examples: [] },
    planConsoleLines: 60,
    gateTests: { complete: 100, distinctAsks: 95 },
    removed: 1,
    retired: 1,
    facts: {
      rules: Object.fromEntries(
        [
          'standing-must',
          'standing-never',
          'standing-always',
          'standing-only-when',
          'skill-must',
          'helper-never',
        ].map((k) => [k, emptyCount]),
      ),
      gates: Object.fromEntries(['before-read', 'read-first', 'requires-loaded'].map((k) => [k, emptyCount])),
      skills: emptyCount,
      references: emptyCount,
      foreignReferences: { skills: 0, edges: 0, examples: [] },
      nonNormative: { documents: 10, ruleAtoms: 0, examples: [] },
      guards: { planted: 113, resolved: 113, described: 113, missedTarget: [], missedText: [] },
    },
  });
  const failing = (measured: Measured) =>
    [...judgeReal(measured)].filter(([, r]) => !r.pass).map(([id]) => id);

  it('passes a product that finds everything within the budgets', () => {
    expect(judgeReal(fine()).size).toBe(24);
    expect(failing(fine())).toEqual([]);
  });

  it('budgets time at the 5,000-atom rate over the files and prose of the estate, with the floor', () => {
    const units = realUnits(6845, 10_700_000);
    expect(units).toBe(6845 + 1070);
    expect(realBudgetMs('plan', units)).toBe(6 * units);
    expect(realBudgetMs('impact', 10)).toBe(4000);
  });

  it('fails exactly the item of each fault, correct and slow or fast and wrong alike', () => {
    const slow = fine();
    slow.planMs = 83_000;
    expect(failing(slow)).toEqual(['scale-real.time-plan']);
    const noRule = fine();
    noRule.facts.rules['standing-must'] = { planted: 1, found: 0, missed: ['CLAUDE.md:12 x'] };
    expect(failing(noRule)).toEqual(['scale-real.rules-standing-must']);
    const flat = fine();
    flat.facts.foreignReferences = { skills: 57, edges: 199_000, examples: ['a'] };
    expect(failing(flat)).toEqual(['scale-real.references-owned']);
    const loud = fine();
    loud.planConsoleLines = 199_052;
    expect(failing(loud)).toEqual(['scale-real.plan-console']);
    const same = fine();
    same.gateTests = { complete: 2601, distinctAsks: 1 };
    expect(failing(same)).toEqual(['scale-real.generation-diversity']);
    const wide = fine();
    wide.retired = 5;
    expect(failing(wide)).toEqual(['scale-real.impact-exact']);
    const noGate = fine();
    noGate.facts.gates = {};
    expect(failing(noGate).sort()).toEqual([
      'scale-real.gates-before-read',
      'scale-real.gates-read-first',
      'scale-real.gates-requires-loaded',
    ]);
    const logs = fine();
    logs.lintOnDocuments = { findings: 4, examples: ['x'] };
    logs.facts.nonNormative.ruleAtoms = 2;
    expect(failing(logs).sort()).toEqual(['scale-real.roles-no-findings', 'scale-real.roles-no-rules']);
  });
});
