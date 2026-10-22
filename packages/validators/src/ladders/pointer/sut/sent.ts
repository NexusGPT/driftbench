import type { ListedCandidates } from './port';

/**
 * What a request lists for a labeler to point at, read after the request was built. The only structured carrier
 * of a candidate is the context a reader hands to its renderer; the wire holds it as prompt text. So the context
 * says which candidates were meant, and the serialised request says which of them were sent: a candidate counts
 * as sent only when its exact id and its exact title both occur in a string of the request. A substring search of
 * a string the item knows, never a pattern on prose.
 */

/** Every string of a value, at any depth: the text of a request as the characters it holds, never JSON escapes. */
export function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** The candidates whose id and title are both in the text of the request. */
export function keepSent(
  candidates: ReadonlyArray<{ id: string; title: string }>,
  texts: readonly string[],
): Array<{ id: string; title: string }> {
  return candidates
    .filter((c) => texts.some((text) => text.includes(c.id)) && texts.some((text) => text.includes(c.title)))
    .map((c) => ({ id: c.id, title: c.title }));
}

/** Adds one row per link kind with the candidates that reached the request; a row is added once. */
export function recordSent(
  into: { rows: ListedCandidates[]; seen: Set<string> },
  where: { file: string; window: string; set: string },
  byLink: Readonly<Record<string, ReadonlyArray<{ id: string; title: string }>>>,
  texts: readonly string[],
): void {
  for (const [link, list] of Object.entries(byLink)) {
    const row: ListedCandidates = { ...where, link, candidates: keepSent(list, texts) };
    const key = JSON.stringify(row);
    if (into.seen.has(key)) continue;
    into.seen.add(key);
    into.rows.push(row);
  }
}
