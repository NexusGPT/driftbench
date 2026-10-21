import { ReaderNotReachable } from '../sut/port';
import { Unsupported } from '../sut/blind-binding/reader';

/**
 * The wire between the process that holds the oracle of an item and the process that holds the reader (`reader-link.ts`
 * and `reader-host.ts`). The oracle process sends calls; the reader process answers them and, while it answers, asks
 * the oracle process for a callback (a labeller or a transport the item planted) or reports an effect (a key read, a
 * cassette write). The reader process never sends anything the oracle process takes for a verdict: a verdict is
 * computed by the oracle from the answers.
 *
 * Messages, oracle to reader: `call` (id, target, path, args), `cbok` / `cberr` (id; the answer to a callback).
 * Reader to oracle: `ok` / `err` (id; the answer to a call), `cb` (id, fn, args), `iofetch` (id, call, args), `io`
 * (call, op, args; an effect, no answer).
 */

export type WireError = { name: string; message: string; stack?: string };

/** The marker that stands for a function in the data of a message. */
export const FN = '@fn';

export type Target = 'ping' | 'ready' | 'sut' | 'blind';

export type CallMessage = { t: 'call'; id: number; target: Target; path: string[]; args: unknown[] };

export function wireError(cause: unknown): WireError {
  if (cause instanceof Error)
    return { name: cause.name, message: cause.message, ...(cause.stack ? { stack: cause.stack } : {}) };
  return { name: 'Error', message: String(cause) };
}

/** An error rebuilt from the wire: the two classes the bank tells apart keep their class. */
export function reviveError(wire: WireError): Error {
  const proto =
    wire.name === 'ReaderNotReachable'
      ? ReaderNotReachable.prototype
      : wire.name === 'Unsupported'
        ? Unsupported.prototype
        : Error.prototype;
  const error = Object.create(proto) as Error;
  Object.defineProperty(error, 'message', {
    value: wire.message,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(error, 'name', { value: wire.name, writable: true, configurable: true });
  if (wire.stack !== undefined)
    Object.defineProperty(error, 'stack', { value: wire.stack, writable: true, configurable: true });
  return error;
}

function hasFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasFunction);
  return Object.keys(value).some((key) => hasFunction((value as Record<string, unknown>)[key]));
}

function hasMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasMarker);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === FN) return true;
  return keys.some((key) => hasMarker((value as Record<string, unknown>)[key]));
}

function copyWith(value: object, change: (item: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map(change);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value))
    Object.defineProperty(out, key, {
      value: change((value as Record<string, unknown>)[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return out;
}

/** Data that can cross the wire: every function becomes a marker that names a handle the sender keeps. */
export function encode(value: unknown, handle: (fn: (...args: unknown[]) => unknown) => number): unknown {
  if (typeof value === 'function') return { [FN]: handle(value as (...args: unknown[]) => unknown) };
  if (value === null || typeof value !== 'object' || !hasFunction(value)) return value;
  return copyWith(value, (item) => encode(item, handle));
}

/** The reverse: every marker becomes a function that asks the sender to call the handle it names. */
export function decode(value: unknown, stub: (handle: number) => (...args: unknown[]) => Promise<unknown>): unknown {
  if (value === null || typeof value !== 'object' || !hasMarker(value)) return value;
  const keys = Object.keys(value);
  if (!Array.isArray(value) && keys.length === 1 && keys[0] === FN) {
    const handle = (value as Record<string, unknown>)[FN];
    if (typeof handle === 'number') return stub(handle);
  }
  return copyWith(value, (item) => decode(item, stub));
}

/** The names of the functions an object holds, own and inherited, for the descriptor of a reader. */
export function methodsOf(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  const names = new Set<string>();
  for (let at: object | null = value; at && at !== Object.prototype; at = Object.getPrototypeOf(at)) {
    for (const name of Object.getOwnPropertyNames(at)) {
      if (name !== 'constructor' && typeof (value as Record<string, unknown>)[name] === 'function')
        names.add(name);
    }
  }
  return [...names].sort();
}

/** What the oracle process learns of the reader when it has loaded: its name and the shape of its optional parts. */
export type Descriptor = {
  name: string;
  isolate: boolean;
  /** For each optional part the reader offers (`links`, `rerun`, `settings`, `stack`), the names of its methods. */
  parts: Record<string, string[]>;
};

export const PARTS = ['links', 'rerun', 'settings', 'stack'] as const;
