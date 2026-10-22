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

const hasSubject = (label: SpanLabel | undefined): label is Extract<SpanLabel, { subject: string }> =>
  label !== undefined && (label.kind === 'numeric' || label.kind === 'range') && typeof label.subject === 'string';

/** The text of a clause up to the first digit or symbol, white space and case folded. */
export function prefixOf(text: string): string {
  const cut = text.search(/[^\p{L}\s'’-]/u);
  const head = cut < 0 ? text : text.slice(0, cut);
  return head.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Gives the clauses of one prefix one subject: that of the first of them in text order. Only numeric and range
 * labels take part, and a prefix with no letters is left alone. Returns new clauses; the input is not changed.
 */
export function shareSubjects<T extends LabelledClause>(clauses: readonly T[]): T[] {
  return [...clauses];
}
function shareSubjectsReal<T extends LabelledClause>(clauses: readonly T[]): T[] {
  const first = new Map<string, string>();
  const ordered = [...clauses].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  for (const clause of ordered) {
    const prefix = prefixOf(clause.text);
    if (prefix === '' || !hasSubject(clause.label) || first.has(prefix)) continue;
    first.set(prefix, clause.label.subject);
  }
  return clauses.map((clause) => {
    const subject = first.get(prefixOf(clause.text));
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
    if (label !== undefined && 'subject' in label && typeof label.subject === 'string') out.add(label.subject);
  }
  return [...out].sort();
}

/** Keeps the sound entries of a map a reader returned: both ends known, no self map, chains resolved, cycles dropped. */
export function soundMap(map: unknown, subjects: readonly string[]): Record<string, string> {
  const known = new Set(subjects);
  const direct: Record<string, string> = {};
  if (map === null || typeof map !== 'object') return direct;
  for (const [from, to] of Object.entries(map as Record<string, unknown>)) {
    if (!known.has(from) || typeof to !== 'string' || !known.has(to) || from === to) continue;
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

/** Applies a map of subjects to clauses. Returns new clauses. */
export function applySubjects<T extends LabelledClause>(clauses: readonly T[], _map: Record<string, string>): T[] {
  return [...clauses];
}
function applySubjectsReal<T extends LabelledClause>(clauses: readonly T[], map: Record<string, string>): T[] {
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
    Object.assign(merged, soundMap(await ask(chunk), chunk));
  }
  return soundMap(merged, subjects);
}
