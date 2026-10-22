import type { SpanLabel } from './sources';

/**
 * One quantity, one subject. The store merges condition spans by the subject of their label (docs/variables.md R4),
 * so two clauses that name one quantity under two subjects ("order amount", "order value") would become two
 * variables. This module makes the subjects agree in two steps that read no English of their own:
 *
 * 1. `shareSubjects`: clauses with the same text up to the first digit or symbol name the same quantity by
 *    construction (the words before the number are the same), so they share one subject. Structure only.
 * 2. `canonicalSubjects`: a reader (a model) is shown the distinct subjects and says which of them name one quantity.
 *    Code only checks and records the answer (`soundMap`): both ends are subjects it was shown, no subject maps to
 *    itself, a chain is followed to its end, and every subject on a cycle is dropped.
 */

export type LabelledClause = { text: string; label?: SpanLabel };

/** The unit a label carries; none when it has none. Two clauses of one quantity carry the same unit. */
const unitOf = (label: SpanLabel | undefined): string =>
  label !== undefined && 'unit' in label && typeof label.unit === 'string' ? label.unit.trim().toLowerCase() : '';

const hasSubject = (label: SpanLabel | undefined): label is Extract<SpanLabel, { subject: string }> =>
  label !== undefined &&
  (label.kind === 'numeric' || label.kind === 'range') &&
  typeof label.subject === 'string';

/**
 * The text of a clause up to the first digit or sign that starts a number (a hyphen is a word mark, so only the
 * plus sign, currency, percent, comparison and minus signs count), white space folded, case kept (a clause in capitals is another clause). It is
 * empty when the clause has no such start or when the text before it holds anything but letters, spaces, apostrophes
 * and hyphens: a clause whose words run into other symbols (a name with dots or brackets) is never grouped.
 */
export function prefixOf(text: string): string {
  const cut = text.search(/[\d+$€£%<>=≥≤−]/u);
  if (cut < 0) return '';
  const head = text.slice(0, cut).replace(/\s+/g, ' ').trim();
  return /^[\p{L} '’-]+$/u.test(head) ? head : '';
}

/**
 * Gives the clauses of one prefix one subject: that of the first of them in text order. Only numeric and range
 * labels take part, and a prefix with no letters is left alone. Returns new clauses; the input is not changed.
 */
export function shareSubjects<T extends LabelledClause>(clauses: readonly T[]): T[] {
  const first = new Map<string, string>();
  const ordered = [...clauses].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  for (const clause of ordered) {
    const prefix = prefixOf(clause.text);
    const key = `${unitOf(clause.label)}\u0000${prefix}`;
    if (prefix === '' || !hasSubject(clause.label) || first.has(key)) continue;
    first.set(key, clause.label.subject);
  }
  return clauses.map((clause) => {
    const subject = first.get(`${unitOf(clause.label)}\u0000${prefixOf(clause.text)}`);
    return hasSubject(clause.label) && subject !== undefined && clause.label.subject !== subject
      ? { ...clause, label: { ...clause.label, subject } }
      : clause;
  });
}

/** The distinct subjects of clauses, in a stable order. */
export function subjectsOf(clauses: readonly LabelledClause[]): string[] {
  const out = new Set<string>();
  for (const clause of clauses) {
    const label = clause.label;
    if (label !== undefined && 'subject' in label && typeof label.subject === 'string')
      out.add(label.subject);
  }
  return [...out].sort();
}

/** Keeps the sound entries of a map a reader returned: both ends known, no self map, chains resolved, cycles dropped. */
export function soundMap(
  map: unknown,
  subjects: readonly string[],
  units?: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, string> {
  const known = new Set(subjects);
  const direct: Record<string, string> = {};
  if (map === null || typeof map !== 'object') return direct;
  for (const [from, to] of Object.entries(map as Record<string, unknown>)) {
    if (!known.has(from) || typeof to !== 'string' || !known.has(to) || from === to) continue;
    // Two subjects merge only when every clause of both carries one and the same unit.
    if (units !== undefined) {
      const both = new Set([...(units.get(from) ?? []), ...(units.get(to) ?? [])]);
      if (both.size > 1) continue;
    }
    direct[from] = to;
  }
  const end: Record<string, string> = {};
  for (const from of Object.keys(direct)) {
    const seen = new Set([from]);
    let at = direct[from] as string;
    while (at in direct && !seen.has(at)) {
      seen.add(at);
      at = direct[at] as string;
    }
    if (!seen.has(at)) end[from] = at;
  }
  return end;
}

/** The set of units carried by the clauses of each subject. */
export function unitsBySubject(clauses: readonly LabelledClause[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const clause of clauses) {
    const label = clause.label;
    if (label === undefined || !('subject' in label) || typeof label.subject !== 'string') continue;
    const set = out.get(label.subject) ?? new Set<string>();
    set.add(unitOf(label));
    out.set(label.subject, set);
  }
  return out;
}

/** Applies a map of subjects to clauses. Returns new clauses. */
export function applySubjects<T extends LabelledClause>(
  clauses: readonly T[],
  map: Record<string, string>,
): T[] {
  return clauses.map((clause) => {
    const label = clause.label;
    if (label === undefined || !('subject' in label) || typeof label.subject !== 'string') return clause;
    const to = map[label.subject];
    return to === undefined ? clause : { ...clause, label: { ...label, subject: to } };
  });
}

/**
 * The sibling pass: `ask(subjects)` returns an object from a subject to the subject that names the same quantity.
 * Asked in chunks of `size` sorted subjects, so a long list stays within one call's size. Returns the sound map.
 */
export async function canonicalSubjects(
  clauses: readonly LabelledClause[],
  ask: (subjects: string[]) => Promise<unknown>,
  size = 300,
): Promise<Record<string, string>> {
  const subjects = subjectsOf(clauses);
  const merged: Record<string, string> = {};
  for (let i = 0; i < subjects.length; i += size) {
    const chunk = subjects.slice(i, i + size);
    Object.assign(merged, soundMap(await ask(chunk), chunk, unitsBySubject(clauses)));
  }
  return soundMap(merged, subjects, unitsBySubject(clauses));
}
