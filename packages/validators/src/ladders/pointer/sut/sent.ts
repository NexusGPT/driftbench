import { AsyncLocalStorage } from 'node:async_hooks';
import type { ListedCandidates } from './port';

/**
 * What a request lists for a labeler to point at, read from the bytes the transport received. The only
 * structured carrier of a candidate is the context a reader hands to its renderer; the wire holds it as prompt
 * text. So the context says which candidates were meant (the exact strings to look for), and the request body
 * the transport RECEIVED says which of them were sent: a candidate counts as sent only when its exact id and its
 * exact title both occur in that string. Nothing here serialises anything: the string is the one the product
 * handed to the transport, and the row keeps it (`body`) so a test compares it with what the transport got.
 * A substring search of strings the item knows, never a pattern on prose.
 */

/** A string as it appears inside serialised JSON (quotes, backslashes and control characters escaped). */
function inJson(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

/** The candidates whose id and title are both in the received body. */
export function keepSent(
  candidates: ReadonlyArray<{ id: string; title: string }>,
  received: string,
): Array<{ id: string; title: string }> {
  return candidates
    .filter((c) => received.includes(inJson(c.id)) && received.includes(inJson(c.title)))
    .map((c) => ({ id: c.id, title: c.title }));
}

/** The candidates a request was meant to list, by link kind, with the window it was built for. */
export type Meant = {
  where: { file: string; window: string; set: string };
  byLink: Readonly<Record<string, ReadonlyArray<{ id: string; title: string }>>>;
};

/**
 * Adds one row per link kind with the candidates that reached the request, and the exact body the transport
 * received. A row is added once.
 */
export function recordSent(
  into: { rows: ListedCandidates[]; seen: Set<string> },
  meant: Meant,
  received: string,
): void {
  for (const [link, list] of Object.entries(meant.byLink)) {
    const row: ListedCandidates = {
      ...meant.where,
      link,
      candidates: keepSent(list, received),
      body: received,
    };
    const key = JSON.stringify(row);
    if (into.seen.has(key)) continue;
    into.seen.add(key);
    into.rows.push(row);
  }
}

/** The store value of a call whose wire the renderer never returned: no context, so nothing is listed. */
const EMPTY: unique symbol = Symbol('no rendered wire');
type Scope = Meant | typeof EMPTY;

/**
 * Pairs a request with its context, keyed by wire identity. The renderer notes the context against the wire
 * object it returns; the wrapped `call` runs inside an async scope for exactly that wire; the fetch the labeler
 * posts through reports the body string it was handed inside that scope. A request is attributed only to the
 * context that rendered its exact wire. Every call enters the scope explicitly: a wire with no entry runs in the
 * EMPTY scope (never by leaving the enclosing scope in place), so a request nested in a call, a retry, a halved
 * window or a stack of labelers can never inherit the context of an enclosing request. The scope follows the
 * request through every await, so concurrent requests of several files never swap contexts. A body reported in
 * the EMPTY scope, outside any scope, or from a wire the renderer never returned lists nothing.
 */
export class SentRecorder {
  private readonly noted = new WeakMap<object, Meant>();
  private readonly scope = new AsyncLocalStorage<Scope>();

  constructor(readonly into: { rows: ListedCandidates[]; seen: Set<string> }) {}

  /** The renderer returned `wire` for this context. */
  note(wire: object, meant: Meant): void {
    this.noted.set(wire, meant);
  }

  /** Runs the call that sends `wire`; every body reported meanwhile belongs to the context noted for that wire. */
  during<T>(wire: object, run: () => T): T {
    return this.scope.run(this.noted.get(wire) ?? EMPTY, run);
  }

  /** The transport receives this body string: the one place a listed candidate is read. */
  received(body: string): void {
    const meant = this.scope.getStore();
    if (meant === undefined || meant === EMPTY) return;
    recordSent(this.into, meant, body);
  }
}
