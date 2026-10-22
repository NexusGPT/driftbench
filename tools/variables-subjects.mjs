// One quantity, one subject. The labeller names the quantity of each condition span; the store merges spans by that
// name (docs/variables.md R4), so a clause named "order amount" and a sibling named "order value" would become two
// variables. This module makes the names agree, in two steps that read no English of their own:
//
//   1. shareSubjects: spans with the same text up to the first digit or symbol name the same quantity by
//      construction (the words before the number are the same), so they share one subject. Structure only.
//   2. canonicalSubjects: the model is shown the distinct subjects of the recording and says which of them name one
//      quantity. Code only checks and records the answer: every key is a subject of the recording, every value is
//      one of those subjects, and a subject maps to itself or to a subject that maps to itself.

const NUMBERED = new Set(['numeric', 'range']);

/** The text of a span up to the first digit or symbol, white space folded and case folded. */
export function prefixOf(text) {
  const cut = text.search(/[^\p{L}\s'’-]/u);
  const head = cut < 0 ? text : text.slice(0, cut);
  return head.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Gives the spans of one prefix one subject: the subject of the first of them in text order. Only numeric and range
 * labels take part, and a prefix of fewer than two spans, or of no letters, is left alone. Returns new rows.
 */
export function shareSubjects(rows) {
  const first = new Map();
  const ordered = [...rows].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  for (const row of ordered) {
    const prefix = prefixOf(row.text);
    if (prefix === '' || !NUMBERED.has(row.label?.kind) || typeof row.label.subject !== 'string') continue;
    if (!first.has(prefix)) first.set(prefix, row.label.subject);
  }
  return rows.map((row) => {
    const prefix = prefixOf(row.text);
    const subject = first.get(prefix);
    return subject !== undefined && NUMBERED.has(row.label?.kind) && row.label.subject !== subject
      ? { ...row, label: { ...row.label, subject } }
      : row;
  });
}

/** The distinct subjects of rows, in a stable order. */
export function subjectsOf(rows) {
  return [...new Set(rows.flatMap((row) => (typeof row.label?.subject === 'string' ? [row.label.subject] : [])))].sort();
}

/** Checks a map the model returned and keeps its sound entries: both ends known, and the target maps to itself. */
export function soundMap(map, subjects) {
  const known = new Set(subjects);
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [from, to] of Object.entries(map)) {
    if (!known.has(from) || typeof to !== 'string' || !known.has(to) || from === to) continue;
    out[from] = to;
  }
  // A target that itself maps elsewhere would chain; follow the chain to its end, and drop every subject on a cycle.
  const end = {};
  for (const from of Object.keys(out)) {
    const seen = new Set([from]);
    let at = out[from];
    while (at in out && !seen.has(at)) {
      seen.add(at);
      at = out[at];
    }
    if (!seen.has(at)) end[from] = at;
  }
  return end;
}

/** Applies a map of subjects to rows. Returns new rows. */
export function applySubjects(rows, map) {
  return rows.map((row) => {
    const to = typeof row.label?.subject === 'string' ? map[row.label.subject] : undefined;
    return to === undefined ? row : { ...row, label: { ...row.label, subject: to } };
  });
}

/**
 * The sibling pass: `ask(subjects)` returns an object from a subject to the subject that names the same quantity.
 * Asked in chunks of `size` sorted subjects, so a long recording stays within one call's size. Returns the sound map.
 */
export async function canonicalSubjects(rows, ask, size = 300) {
  const subjects = subjectsOf(rows);
  const merged = {};
  for (let i = 0; i < subjects.length; i += size) {
    const chunk = subjects.slice(i, i + size);
    Object.assign(merged, soundMap(await ask(chunk), chunk));
  }
  return soundMap(merged, subjects);
}
