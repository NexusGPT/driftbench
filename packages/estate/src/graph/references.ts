import { posix } from 'node:path';
import type { Atom } from '../schema';

/** Direct file citations, indexed once. Reachability is computed only for the requested start. */
export class ReferenceIndex {
  private readonly atoms: Map<string, Atom>;
  private readonly inFile = new Map<string, Atom[]>();
  private readonly unitFiles = new Map<string, Atom>();
  private readonly skills: Array<{ folder: string; unit: Atom }>;

  constructor(atoms: readonly Atom[]) {
    this.atoms = new Map(atoms.map((atom) => [atom.id, atom]));
    const units = atoms.filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent');
    for (const unit of units) this.unitFiles.set(unit.provenance.file, unit);
    this.skills = units
      .filter((unit) => unit.kind === 'skill')
      .map((unit) => ({ folder: posix.dirname(unit.provenance.file), unit }))
      .sort((a, b) => b.folder.length - a.folder.length);
    for (const atom of atoms) {
      if (atom.kind !== 'reference') continue;
      const file = atom.provenance.file;
      const list = this.inFile.get(file);
      if (list) list.push(atom);
      else this.inFile.set(file, [atom]);
    }
  }

  /** Ownership is lexical: the citing file's unit, never the units that happen to read it. */
  ownerOf(atom: Atom): Atom | undefined {
    const file = atom.provenance.file;
    return this.unitFiles.get(file) ?? this.skills.find(({ folder }) => file.startsWith(`${folder}/`))?.unit;
  }

  /** Citation atom ids reachable by reading a unit, reference or other atom's file. Cycles terminate. */
  reachableFrom(id: string): Set<string> {
    const start = this.atoms.get(id);
    const found = new Set<string>();
    if (!start) return found;
    const pending = [start.provenance.file];
    const visited = new Set<string>();
    for (let head = 0; head < pending.length; head++) {
      const file = pending[head] as string;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const reference of this.inFile.get(file) ?? []) {
        found.add(reference.id);
        if (typeof reference.fields?.path === 'string') pending.push(reference.fields.path);
      }
    }
    return found;
  }
}
