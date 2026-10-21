import { constructAsk, type MapAtom } from './reference-ask';

/**
 * Binds an ask to its plan row, from the approved map and the validator's own plan, never from what the generated
 * spec says about itself (`metadata.estate.atoms`, `askFrom`): the items that judge asks (gen.asks.asks-approved,
 * gen.asks.misroute-names-another, gen.task) share it.
 */

/** The atom ids a value names, at any depth up to three (a guard's fields name the rule it enforces). */
export function namedIds(value: unknown, atoms: ReadonlyMap<string, MapAtom>, depth = 0): string[] {
  if (typeof value === 'string') return atoms.has(value) ? [value] : [];
  if (Array.isArray(value) && depth < 3) return value.flatMap((item) => namedIds(item, atoms, depth + 1));
  if (value !== null && typeof value === 'object' && depth < 3)
    return Object.values(value).flatMap((item) => namedIds(item, atoms, depth + 1));
  return [];
}

/**
 * The atoms an ask of a plan row may take its words from (docs/estate.md section 5): the row's atoms and the atoms
 * their fields name; a route that names a skill or helper of the row ("a request that routes to the skill or helper
 * that carries it"); and, for a row that holds no skill or helper (a rule of the standing instructions, which holds
 * over any work), the first route of the estate.
 */
export function rowSources(rowAtomIds: readonly string[], atoms: ReadonlyMap<string, MapAtom>): Set<string> {
  const out = new Set<string>();
  for (const id of rowAtomIds) {
    if (!atoms.has(id)) continue;
    out.add(id);
    for (const named of namedIds(atoms.get(id)?.fields, atoms)) out.add(named);
  }
  const units = new Set(
    [...out]
      .map((id) => atoms.get(id))
      .filter((atom) => atom?.kind === 'skill' || atom?.kind === 'subagent')
      .map((atom) => String((atom?.fields as { name?: unknown } | undefined)?.name ?? '')),
  );
  const routes = [...atoms.values()].filter((atom) => atom.kind === 'route');
  for (const route of routes) {
    const target = (route.fields as { target?: unknown } | undefined)?.target;
    if (units.has(String(target ?? ''))) out.add(route.id);
  }
  if (units.size === 0 && routes[0]) out.add(routes[0].id);
  return out;
}

/**
 * A code-written ask rebuilt from its construction record and the map, against the row's sources: the source atom
 * of the record (its first span or tool), or why it is refused (a record that does not rebuild the ask byte for
 * byte, or cites an atom off the row).
 */
export function rebuiltAsk(
  build: unknown,
  ask: string,
  atoms: ReadonlyMap<string, MapAtom>,
  sources: ReadonlySet<string>,
): { source?: string } | { refused: string } {
  const built = constructAsk(build, atoms, sources);
  if ('refused' in built) return built;
  if (built.text !== ask) return { refused: `the record builds "${built.text}"` };
  const record = build as { spans?: Array<{ atom?: unknown }>; tool?: { atom?: unknown } };
  const source = record.spans?.[0]?.atom ?? record.tool?.atom;
  return typeof source === 'string' ? { source } : {};
}

/**
 * The bank situation an ask is an approved phrase of, held by an atom of the row's sources or the one situation the
 * row borrows (borrowedSituation), if any.
 */
type BankSituation = {
  use: string;
  atoms: string[];
  phrases: Array<{ text: string; approved?: boolean }>;
  cell?: Record<string, string>;
};

/**
 * The situation a tool row borrows (docs/estate.md section 5: "a tool boundary uses a situation listing the most
 * rules from its own file"), re-derived from the map and the bank: only for a trigger row whose head is a tool, that
 * names no skill or helper, and that no situation of its use lists; then the situation of that use, its pins agreeing
 * with the row's cell, that lists the most atoms read from the tool atom's own file, the first in bank order on a
 * tie; none when no situation lists such an atom.
 */
export function borrowedSituation<S extends BankSituation>(
  row: { atomIds: readonly string[]; cell?: Readonly<Record<string, string>> },
  use: string,
  situations: readonly S[],
  atoms: ReadonlyMap<string, MapAtom>,
): S | undefined {
  const head = atoms.get(row.atomIds[0] ?? '');
  if (head?.kind !== 'tool' || use !== 'trigger') return undefined;
  if (row.atomIds.some((id) => ['skill', 'subagent'].includes(atoms.get(id)?.kind ?? ''))) return undefined;
  const listed = situations.some((situation) => situation.use === use && situation.atoms.includes(head.id));
  if (listed) return undefined;
  const file = head.provenance?.file;
  if (!file) return undefined;
  let best: S | undefined;
  let most = 0;
  for (const situation of situations) {
    if (situation.use !== use) continue;
    const pins = Object.entries(situation.cell ?? {});
    if (pins.some(([key, value]) => row.cell?.[key] !== undefined && row.cell[key] !== value)) continue;
    const siblings = situation.atoms.filter((id) => atoms.get(id)?.provenance?.file === file).length;
    if (siblings > most) {
      best = situation;
      most = siblings;
    }
  }
  return best;
}

export function bankSituation<S extends BankSituation>(
  situations: readonly S[],
  ask: string,
  sources: ReadonlySet<string>,
  borrowed?: S,
): S | undefined {
  return situations.find(
    (situation) =>
      situation.phrases.some((phrase) => phrase.approved === true && phrase.text === ask) &&
      (situation === borrowed || situation.atoms.some((id) => sources.has(id))),
  );
}
