import type { ListedCandidates } from './port';

/**
 * What a request lists for a labeler to point at, read after the request was built. The only structured carrier
 * of a candidate is the context a reader hands to its renderer; the wire holds it as prompt text. So the context
 * says which candidates were meant, and the bytes of the request body say which of them were sent: a candidate
 * counts as sent only when its exact id and its exact title both occur in those bytes. The bytes are the body
 * serialised as the transport serialises it (`JSON.stringify(wire.body)`), and nothing else of what a renderer
 * returns: no other field of the wire, no header, no address. A substring search of strings the item knows,
 * never a pattern on prose.
 */

/** The body as it goes on the wire: the one place a request is turned into bytes. */
export function serialisedBody(wire: { body: unknown }): string {
  return JSON.stringify(wire.body);
}

/** A string as it appears inside serialised JSON (quotes, backslashes and control characters escaped). */
function inJson(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

/** The candidates whose id and title are both in the serialised body. */
export function keepSent(
  candidates: ReadonlyArray<{ id: string; title: string }>,
  serialised: string,
): Array<{ id: string; title: string }> {
  return candidates
    .filter((c) => serialised.includes(inJson(c.id)) && serialised.includes(inJson(c.title)))
    .map((c) => ({ id: c.id, title: c.title }));
}

/** Adds one row per link kind with the candidates that reached the request; a row is added once. */
export function recordSent(
  into: { rows: ListedCandidates[]; seen: Set<string> },
  where: { file: string; window: string; set: string },
  byLink: Readonly<Record<string, ReadonlyArray<{ id: string; title: string }>>>,
  serialised: string,
): void {
  for (const [link, list] of Object.entries(byLink)) {
    const row: ListedCandidates = { ...where, link, candidates: keepSent(list, serialised) };
    const key = JSON.stringify(row);
    if (into.seen.has(key)) continue;
    into.seen.add(key);
    into.rows.push(row);
  }
}
