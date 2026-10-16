import type { Atom } from '../schema';

/**
 * What a skill or helper reaches by following citations, computed when asked and never stored. The graph keeps
 * one `reference` edge for each citation in a file a unit owns (`edges.ts`); the files those citations lead
 * to, and the files they cite in turn, are found here by walking the reference atoms file by file. A document
 * every unit cites is walked for each unit that asks and stored for none.
 */

/** The reference atoms of each file, by the file they were read in. */
export function citationsByFile(atoms: readonly Atom[]): Map<string, Atom[]> {
  const out = new Map<string, Atom[]>();
  for (const atom of atoms) {
    if (atom.kind !== 'reference') continue;
    const list = out.get(atom.provenance.file);
    if (list) list.push(atom);
    else out.set(atom.provenance.file, [atom]);
  }
  return out;
}

/**
 * The files reached from `start` by following the citations of the map, `start` excluded unless a citation
 * leads back to it. A cycle ends the walk; each file is read once.
 */
export function filesReached(start: string, citations: ReadonlyMap<string, readonly Atom[]>): string[] {
  const seen = new Set<string>();
  const pending = [start];
  const reached: string[] = [];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (file !== start) reached.push(file);
    for (const reference of citations.get(file) ?? []) {
      const target = reference.fields?.path;
      if (typeof target === 'string') pending.push(target);
    }
  }
  return reached.sort();
}

/**
 * The skill or helper each reference atom belongs to, for the atoms no stored edge places: the first unit, in
 * atom order, whose citations lead to the file the atom was read in. Each file is walked once however many
 * units cite it, so the cost is the size of the estate and not units times files.
 */
export function referenceOwners(atoms: readonly Atom[]): Map<string, string> {
  const citations = citationsByFile(atoms);
  const owners = new Map<string, string>();
  const claimed = new Set<string>();
  for (const unit of atoms) {
    if (unit.kind !== 'skill' && unit.kind !== 'subagent') continue;
    const pending = [unit.provenance.file];
    const own = unit.provenance.file;
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      // A file an earlier unit claimed leads only to files that unit claimed too. A unit's own file is always walked.
      if (claimed.has(file) && file !== own) continue;
      claimed.add(file);
      for (const reference of citations.get(file) ?? []) {
        if (!owners.has(reference.id)) owners.set(reference.id, unit.id);
        const target = reference.fields?.path;
        if (typeof target === 'string') pending.push(target);
      }
    }
  }
  return owners;
}
