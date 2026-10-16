import type { EstateAtom } from './inputs';

type Link = { from: string; to: string; kind: string };

/**
 * Folder ownership is authoritative. Citation edges describe navigation, never file ownership:
 * a widely cited document must not inherit the first citing skill's task.
 */
export function estateOwners(atoms: readonly EstateAtom[], edges: readonly Link[] = []): Map<string, string> {
  const units = atoms.filter((atom) => atom.kind === 'skill' || atom.kind === 'subagent');
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const owners = new Map<string, string>();
  const ownerOfFile = (file: string | undefined): string | undefined => {
    if (!file) return undefined;
    const path = file.replaceAll('\\', '/').replace(/^\.\//, '');
    const exact = units.filter((unit) => unit.provenance?.file === path);
    if (exact.length === 1) return exact[0]?.id;
    const candidates = units
      .filter((unit) => {
        const source = unit.provenance?.file;
        if (unit.kind !== 'skill' || !source?.includes('/')) return false;
        return path.startsWith(source.slice(0, source.lastIndexOf('/') + 1));
      })
      .sort(
        (a, b) => (b.provenance?.file?.lastIndexOf('/') ?? 0) - (a.provenance?.file?.lastIndexOf('/') ?? 0),
      );
    const first = candidates[0],
      second = candidates[1];
    if (
      first &&
      (!second || first.provenance?.file?.lastIndexOf('/') !== second.provenance?.file?.lastIndexOf('/'))
    )
      return first.id;
    return undefined;
  };
  for (const atom of atoms) {
    if (atom.kind === 'skill' || atom.kind === 'subagent') continue;
    if (atom.kind === 'route') {
      const targets = new Set(
        edges
          .filter((edge) => edge.kind === 'route' && edge.from === atom.id)
          .map((edge) => edge.to)
          .filter((id) => units.some((unit) => unit.id === id)),
      );
      const named = units.filter((unit) => unit.fields?.name === atom.fields?.target);
      if (targets.size === 1) owners.set(atom.id, [...targets][0] as string);
      else if (named.length === 1 && named[0]) owners.set(atom.id, named[0].id);
      continue;
    }
    // A reference is owned by its target file, not the document that happens to cite it.
    // Gate prerequisites and scripts have explicit target paths too.
    const target = ['reference', 'gate', 'script'].includes(atom.kind)
      ? typeof atom.fields?.path === 'string'
        ? atom.fields.path
        : typeof atom.fields?.first === 'string'
          ? atom.fields.first
          : undefined
      : undefined;
    const owner =
      (target ? ownerOfFile(target) : undefined) ??
      (atom.kind === 'reference' && target ? undefined : ownerOfFile(atom.provenance?.file));
    if (owner) owners.set(atom.id, owner);
  }
  for (const guard of atoms.filter((atom) => atom.kind === 'guard')) {
    const candidates = new Set(
      guardRuleIds(guard, byId)
        .map((id) => owners.get(id))
        .filter((id): id is string => id !== undefined),
    );
    const [owner] = candidates;
    if (candidates.size === 1 && owner) owners.set(guard.id, owner);
  }
  return owners;
}

/** Repair stale row context as well as target-only rows. Never retain an unrelated attached unit. */
export function taskAtoms(
  atoms: readonly EstateAtom[],
  lookup: ReadonlyMap<string, EstateAtom>,
  owners: ReadonlyMap<string, string>,
): EstateAtom[] {
  const head = atoms[0];
  if (!head) return [];
  const owner = owners.get(head.id);
  const scoped = head.provenance?.file !== undefined && !['route', 'skill', 'subagent'].includes(head.kind);
  const result = scoped
    ? atoms.filter((atom) => !['skill', 'subagent'].includes(atom.kind) || atom.id === owner)
    : [...atoms];
  const unit = owner ? lookup.get(owner) : undefined;
  if (unit && !result.some((atom) => atom.id === unit.id)) result.push(unit);
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
