import type { EstateAtom } from './inputs';

type Link = { from: string; to: string; kind: string };

/**
 * Resolve the task owner from declared unit files and direct graph links. A standing gate can name a
 * reference belonging to another unit; the longest declared folder wins, never map order or an id slug.
 * Shared references keep their explicitly linked owner; ambiguous folder ties supply no guessed owner.
 */
export function estateOwners(atoms: readonly EstateAtom[], edges: readonly Link[] = []): Map<string, string> {
  const units = atoms.filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent');
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const unitIds = new Set(units.map((atom) => atom.id));
  const owners = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind === 'route' && unitIds.has(edge.to)) owners.set(edge.from, edge.to);
    if (
      (edge.kind === 'reference' || edge.kind === 'script') &&
      unitIds.has(edge.from) &&
      !owners.has(edge.to)
    )
      owners.set(edge.to, edge.from);
  }
  for (const atom of atoms) {
    if (unitIds.has(atom.id) || owners.has(atom.id)) continue;
    const file = atom.provenance?.file;
    const exact = units.filter((unit) => file !== undefined && unit.provenance?.file === file);
    if (exact.length === 1 && exact[0]) {
      owners.set(atom.id, exact[0].id);
      continue;
    }
    // A unit's declared path, not its name, establishes a folder boundary.
    const paths = [
      file,
      ...Object.values(atom.fields ?? {}).filter((value): value is string => typeof value === 'string'),
    ];
    let best: EstateAtom | undefined;
    let depth = -1;
    let tied = false;
    for (const unit of units) {
      const unitFile = unit.provenance?.file;
      if (unit.kind !== 'skill' || !unitFile?.includes('/')) continue; // a top-level helper owns its file, never the whole estate
      const folder = unitFile.slice(0, unitFile.lastIndexOf('/'));
      if (!paths.some((path) => path?.startsWith(`${folder}/`))) continue;
      if (folder.length > depth) {
        best = unit;
        depth = folder.length;
        tied = false;
      } else if (folder.length === depth) tied = true;
    }
    if (best && !tied) owners.set(atom.id, best.id);
    // A route's target is a declared name; a name is only usable when unique.
    if (!owners.has(atom.id) && atom.kind === 'route') {
      const target = atom.fields?.target;
      const named = units.filter((unit) => unit.fields?.name === target);
      if (target && named.length === 1 && named[0]) owners.set(atom.id, named[0].id);
    }
  }
  // A guard serves the situation of its enforced rule, not the folder of its settings file.
  for (const guard of atoms.filter((atom) => atom.kind === 'guard')) {
    const candidates = new Set<string>();
    for (const id of guardRuleIds(guard, byId)) {
      const owner = owners.get(id);
      if (owner) candidates.add(owner);
    }
    const [owner] = candidates;
    if (candidates.size === 1 && owner) owners.set(guard.id, owner);
  }
  return owners;
}

/** Add the owning task to a target-only row without pulling unrelated rules into its assertions. */
export function taskAtoms(
  atoms: readonly EstateAtom[],
  lookup: ReadonlyMap<string, EstateAtom>,
  owners: ReadonlyMap<string, string>,
): EstateAtom[] {
  const result = [...atoms];
  const ids = new Set(atoms.map((atom) => atom.id));
  for (const atom of atoms) {
    const owner = owners.get(atom.id);
    const unit = owner ? lookup.get(owner) : undefined;
    if (unit && !ids.has(unit.id)) {
      ids.add(unit.id);
      result.push(unit);
    }
  }
  return result;
}

/** Resolve optional documented hook sources to existing rules; a generic matcher is not a situation. */
export function guardRuleIds(guard: EstateAtom, atoms: ReadonlyMap<string, EstateAtom>): string[] {
  const links = Array.isArray(guard.fields?.enforces) ? guard.fields.enforces : [];
  const ids = links
    .map((link) => (typeof link === 'string' ? link : link?.atom))
    .filter((id): id is string => typeof id === 'string' && atoms.has(id));
  const sources = Array.isArray(guard.fields?.ruleSources) ? guard.fields.ruleSources : [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const atom of atoms.values()) {
      if (!['gate', 'instruction', 'register'].includes(atom.kind)) continue;
      const p = atom.provenance;
      if (!p || source.file !== p.file) continue;
      const sameQuote = typeof source.quote === 'string' && source.quote.trim() === p.quote.trim();
      const sameSpan =
        typeof source.startLine === 'number' &&
        typeof source.endLine === 'number' &&
        p.startLine !== undefined &&
        p.endLine !== undefined &&
        source.startLine <= p.startLine &&
        source.endLine >= p.endLine;
      if (sameQuote || sameSpan) ids.push(atom.id);
    }
  }
  return [...new Set(ids)];
}
