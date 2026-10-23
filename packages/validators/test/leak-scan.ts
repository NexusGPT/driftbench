import { ItemFailure } from '../src/failure';

/**
 * The second leak check, which does not rely on what a site declares. A correct product and a wrong one are run on the
 * same item; every token that the correct one returned and the wrong one did not is what the item wants. A failure
 * message of the wrong product may not repeat such a token, wherever the site put it (rule, input or got), unless the
 * wrong product returned it too or the item gave it as input.
 * Only tokens that can be a value are looked at: a number, or a code written with capitals or separators.
 */
const TOKEN = /[A-Za-z0-9_.\-/]{2,}/g;

const text = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_k, x) => (typeof x === 'bigint' ? `${x}` : x)) ?? '';
  } catch {
    return '';
  }
};

function lengthsIn(value: unknown, sink: Set<string>, depth = 0): void {
  if (depth > 3 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) sink.add(String(value.length));
  for (const v of Object.values(value as Record<string, unknown>)) lengthsIn(v, sink, depth + 1);
}

/** Wraps an implementation so that every token of what it returns lands in `sink`. */
export function tapped<I extends Record<string, unknown>>(impl: I, sink: Set<string>): I {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(impl)) {
    out[name] =
      typeof fn === 'function'
        ? (...args: unknown[]) => {
            // What the item handed to the product is the item's own input, and may be printed back.
            for (const t of text(args).match(TOKEN) ?? []) sink.add(t);
            lengthsIn(args, sink);
            const result = (fn as (...a: unknown[]) => unknown)(...args);
            if (!(result instanceof Promise)) {
              for (const t of text(result).match(TOKEN) ?? []) sink.add(t);
              // The exact length of the product's own collections (rows, entries, errors) is the product's: an item may print it.
              lengthsIn(result, sink);
            }
            return result;
          }
        : fn;
  }
  return out as I;
}

const valueLike = (token: string): boolean =>
  /\d/.test(token) || /[A-Z_]{4,}/.test(token) || /[_./]/.test(token);

/** The tokens of the message that the correct product returned, that the wrong one did not, and that look like values. */
export function wantedInMessage(
  error: unknown,
  reference: ReadonlySet<string>,
  wrong: ReadonlySet<string>,
  itemId: string,
): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const own = error instanceof ItemFailure ? `${text(error.fields.input)} ${itemId}` : itemId;
  const ownTokens = new Set(own.match(TOKEN) ?? []);
  const inMessage = new Set(message.match(TOKEN) ?? []);
  return [...reference].filter((t) => !wrong.has(t) && valueLike(t) && inMessage.has(t) && !ownTokens.has(t));
}
