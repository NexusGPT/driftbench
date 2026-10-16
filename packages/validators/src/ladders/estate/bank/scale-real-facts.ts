import type { Atom, EstateMap } from '@agent-nexus/driftbench-estate';
import type { RealTruth } from './scale-real-estate';

/**
 * What the oracle reads off a map of the real-size estate, against the truth the estate was planted from. Pure:
 * the worker measures the stages, this module only compares a map with the plan of the estate. Level-1
 * strictness: a planted rule counts as found when an atom of the right kind sits on its line with its words.
 */

export type Count = { planted: number; found: number; missed: string[] };
export type RealFacts = {
  rules: Record<string, Count>;
  gates: Record<string, Count>;
  skills: Count;
  references: Count;
  /** Skills whose reference edges reach a file of another skill that no cross-reference plants. */
  foreignReferences: { skills: number; edges: number; examples: string[] };
  /** Rule atoms and live-reference findings that come from documents that are not rules. */
  nonNormative: { documents: number; ruleAtoms: number; examples: string[] };
  guards: {
    planted: number;
    resolved: number;
    described: number;
    missedTarget: string[];
    missedText: string[];
  };
};

const normal = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
const RULE_KINDS = new Set(['instruction', 'gate', 'register']);

function covers(atom: Atom, file: string, line: number): boolean {
  return (
    atom.provenance.file === file && atom.provenance.startLine <= line && line <= atom.provenance.endLine
  );
}

function tally(planted: number, missed: string[]): Count {
  return { planted, found: planted - missed.length, missed: missed.slice(0, 3) };
}

/** Where a planted rule lives: the standing file, a skill or a helper. */
export function placeOf(file: string): 'standing' | 'skill' | 'helper' {
  if (file.includes('/agents/')) return 'helper';
  if (file.includes('/skills/')) return 'skill';
  return 'standing';
}

export function readFacts(map: EstateMap, truth: RealTruth): RealFacts {
  const atoms = map.atoms;
  const byFile = new Map<string, Atom[]>();
  for (const atom of atoms)
    byFile.set(atom.provenance.file, [...(byFile.get(atom.provenance.file) ?? []), atom]);
  const onLine = (file: string, line: number) =>
    (byFile.get(file) ?? []).filter((atom) => covers(atom, file, line));

  const rules: Record<string, Count> = {};
  const groups = new Map<string, string[]>();
  const totals = new Map<string, number>();
  for (const rule of truth.rules) {
    const key = `${placeOf(rule.file)}-${rule.form}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
    const found = onLine(rule.file, rule.line).some(
      (atom) => RULE_KINDS.has(atom.kind) && normal(atom.provenance.quote).includes(normal(rule.core)),
    );
    if (!found) groups.set(key, [...(groups.get(key) ?? []), `${rule.file}:${rule.line} ${rule.text}`]);
  }
  for (const [key, total] of totals) rules[key] = tally(total, groups.get(key) ?? []);

  const gates: Record<string, Count> = {};
  for (const gate of truth.gates) {
    const found = onLine(gate.file, gate.line).some(
      (atom) => atom.kind === 'gate' && normal(atom.provenance.quote).includes(normal(gate.core)),
    );
    gates[gate.form] = tally(1, found ? [] : [`${gate.file}:${gate.line} ${gate.text}`]);
  }

  const skillAtoms = new Map(
    atoms.filter((atom) => atom.kind === 'skill').map((atom) => [atom.provenance.file, atom]),
  );
  const skillsMissed = truth.skills.filter((skill) => !skillAtoms.has(skill.file)).map((skill) => skill.file);

  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const edgesOf = new Map<string, string[]>();
  for (const edge of map.edges) {
    if (edge.kind !== 'reference') continue;
    edgesOf.set(edge.from, [...(edgesOf.get(edge.from) ?? []), edge.to]);
  }
  const referencesMissed: string[] = [];
  let referencesPlanted = 0;
  const foreign: string[] = [];
  let foreignEdges = 0;
  let foreignSkills = 0;
  for (const skill of truth.skills) {
    const atom = skillAtoms.get(skill.file);
    const folder = skill.file.replace(/\/SKILL\.md$/, '');
    const targets = (atom ? (edgesOf.get(atom.id) ?? []) : []).flatMap((id) => {
      const target = byId.get(id);
      return target ? [target] : [];
    });
    // A reference belongs to the skill whose file cites it: its citing file sits in the skill's folder.
    const mine = (target: Atom) => target.provenance.file.startsWith(`${folder}/`);
    const wrong = targets.filter((target) => !mine(target));
    if (wrong.length > 0) {
      foreignSkills += 1;
      foreignEdges += wrong.length;
      if (foreign.length < 3)
        foreign.push(
          `${skill.name} reaches ${wrong.length} references cited by other files, such as ${wrong[0]?.provenance.file}`,
        );
    }
    // The references the skill's body names: all its own, and its cross-reference.
    const reached = targets.filter(mine).map((target) => String(target.fields?.path ?? ''));
    const cited = skill.references.map((r) => `${folder}/${r}`).concat(skill.crossRefs);
    for (const path of cited) {
      referencesPlanted += 1;
      if (!reached.some((r) => r !== '' && (path.endsWith(r) || r.endsWith(path))))
        referencesMissed.push(path);
    }
  }

  const documents = new Set(truth.nonNormative);
  const fromDocuments = atoms.filter(
    (atom) => documents.has(atom.provenance.file) && (RULE_KINDS.has(atom.kind) || atom.kind === 'hazard'),
  );

  const guardAtoms = atoms.filter((atom) => atom.kind === 'guard');
  const missedTarget: string[] = [];
  const missedText: string[] = [];
  let resolved = 0;
  let described = 0;
  for (const guard of truth.guards) {
    const atom = guardAtoms.find((candidate) => candidate.fields?.name === guard.name);
    if (atom && atom.fields?.script === guard.script) resolved += 1;
    else missedTarget.push(guard.name);
    if (atom && normal(JSON.stringify(atom)).includes(normal(guard.description))) described += 1;
    else missedText.push(guard.name);
  }

  return {
    rules,
    gates,
    skills: tally(truth.skills.length, skillsMissed),
    references: tally(referencesPlanted, referencesMissed),
    foreignReferences: { skills: foreignSkills, edges: foreignEdges, examples: foreign },
    nonNormative: {
      documents: documents.size,
      ruleAtoms: fromDocuments.length,
      examples: fromDocuments
        .slice(0, 3)
        .map((atom) => `${atom.provenance.file}:${atom.provenance.startLine} ${atom.kind}`),
    },
    guards: {
      planted: truth.guards.length,
      resolved,
      described,
      missedTarget: missedTarget.slice(0, 3),
      missedText: missedText.slice(0, 3),
    },
  };
}
