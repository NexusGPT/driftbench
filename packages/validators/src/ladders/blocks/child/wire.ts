/**
 * The wire between the blocks bank and the product it measures (docs/validators.md section 13, "The bank runs
 * the product through the frame"). The bank's process holds no product module: every product call crosses to
 * the frame's two child processes as data. A value the product hands back that is not data (a function, an
 * object with methods, a class instance, an error) stays in the child and crosses as a tagged reference; a
 * function the bank hands the product (a scripted agent's reply, a custom check, an event sink) stays in the bank
 * and crosses as a tagged callback the child calls back through the frame. Both sides share these tags.
 *
 * A tagged value is an object with the one key `TAG`, whose value is an array: the kind, then its parts.
 *
 * | Kind | Way | Parts |
 * |---|---|---|
 * | f | to the bank | id, name, length: a function that stays in the child |
 * | o | to the bank | id, class name: an object that stays in the child, read and called through the frame |
 * | p | to the bank | id, the data: a plain object or array, copied, with its id so an unchanged copy goes back as itself |
 * | e | both | id (or null), name, message, class name, own fields: an error |
 * | c | to the child | id: a function of the bank, called back through the frame |
 * | k | to the child | value: a function of the bank that returns this value, every call (a clock, a fixed draw) |
 * | r | to the child | id, changed fields: the value the child holds under this id |
 * | x | both | source, flags: a regular expression |
 * | b | both | base64: a Buffer |
 * | t | both | typed array class, base64 |
 * | ab | both | base64: an ArrayBuffer |
 * | y | to the bank | description: a symbol, as a string |
 */

export const TAG = '\u0000blk';

export type Wire = unknown;

export function tagged(value: unknown): unknown[] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!Object.hasOwn(value, TAG)) return undefined;
  const parts = (value as Record<string, unknown>)[TAG];
  return Array.isArray(parts) ? parts : undefined;
}

export function tag(...parts: unknown[]): Record<string, unknown[]> {
  return { [TAG]: parts };
}

/** Whether a value is a plain object: its prototype is Object.prototype or null. */
export function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The same wire value with `change` applied to every string in it, keys of plain objects included. Tagged values
 * are walked like any array, so a path inside a reference's changed fields is changed too.
 */
export function mapStrings(value: Wire, change: (text: string) => string): Wire {
  if (typeof value === 'string') return change(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((each) => mapStrings(each, change));
  if (value instanceof Map)
    return new Map([...value].map(([k, v]) => [mapStrings(k, change), mapStrings(v, change)]));
  if (value instanceof Set) return new Set([...value].map((each) => mapStrings(each, change)));
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, each] of Object.entries(value))
    out[key === TAG ? key : change(key)] = mapStrings(each, change);
  return out;
}

/** A replacer of path prefixes: each `from` becomes its `to`, longest first, wherever it appears in a text. */
export function prefixMap(pairs: readonly (readonly [string, string])[]): (text: string) => string {
  const sorted = pairs
    .filter(([from, to]) => from !== '' && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  if (sorted.length === 0) return (text) => text;
  return (text) => {
    if (!sorted.some(([from]) => text.includes(from))) return text;
    let out = '';
    let at = 0;
    outer: while (at < text.length) {
      for (const [from, to] of sorted) {
        if (text.startsWith(from, at)) {
          out += to;
          at += from.length;
          continue outer;
        }
      }
      out += text[at];
      at += 1;
    }
    return out;
  };
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/g;
/** The six random characters a temporary folder's name ends with (`mkdtemp`), inside a path. */
const TEMP_NAME = /(\/[^/\s"'`]*-)[A-Za-z0-9]{6}(?=\/|$|["'`\s,;:)\]}])/g;

/**
 * A text as the frame compares it between its two runs: each time of day, random id, hex token and temporary
 * folder suffix masked. They are read from the machine's clock and random source, not from how the product is
 * run, so they differ between any two runs; every other character must be the same.
 */
export function steadyText(text: string): string {
  return text
    .replace(ISO_TIME, '<time>')
    .replace(UUID, '<id>')
    .replace(HEX, '<hex>')
    .replace(TEMP_NAME, '$1XXXXXX');
}
