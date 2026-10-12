import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every depth, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortKeys(child);
    }
    return out;
  }
  return value;
}

/** The first 12 hex characters of the SHA-256 of the canonical JSON. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 12);
}

/**
 * A deep copy of JSON-shaped data. Plain objects, arrays and primitives are copied by hand, which costs a
 * fraction of `structuredClone`; any other value (a Date, a Map, a class instance) goes to `structuredClone`.
 */
export function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) out[index] = cloneJson(value[index]);
    return out as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return structuredClone(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = cloneJson((value as Record<string, unknown>)[key]);
  return out as T;
}

const canonicalOfItem = new WeakMap<object, string>();
const canonicalOfList = new WeakMap<readonly unknown[], string>();

/**
 * The canonical JSON of a list, as `canonicalJson` writes it, with the text of each object item read once
 * for the life of the item. A caller promises not to change an item after it joined a list given here, so a
 * history that grows by one message per block costs one new text per block, not one per message. The text
 * of a list is read once as well: the list is read-only once it is given here.
 */
export function canonicalList(items: readonly unknown[]): string {
  const known = canonicalOfList.get(items);
  if (known !== undefined) return known;
  const parts = new Array<string>(items.length);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === null || typeof item !== 'object') {
      parts[index] = canonicalJson(item === undefined ? null : item);
      continue;
    }
    let text = canonicalOfItem.get(item);
    if (text === undefined) {
      text = canonicalJson(item);
      canonicalOfItem.set(item, text);
    }
    parts[index] = text;
  }
  const text = `[${parts.join(',')}]`;
  canonicalOfList.set(items, text);
  return text;
}

/**
 * `canonicalJson` of an object whose `listKey` field is a list, with that list written by `canonicalList`.
 * The text is the one `canonicalJson` gives for the same value.
 */
export function canonicalJsonWithList(value: Record<string, unknown>, listKey: string): string {
  const fields: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child === undefined) continue;
    const text = key === listKey && Array.isArray(child) ? canonicalList(child) : canonicalJson(child);
    fields.push(`${JSON.stringify(key)}:${text}`);
  }
  return `{${fields.join(',')}}`;
}

/** `contentHash` of an object whose `listKey` field is a list, without re-reading the items of the list. */
export function contentHashWithList(value: Record<string, unknown>, listKey: string): string {
  return createHash('sha256').update(canonicalJsonWithList(value, listKey)).digest('hex').slice(0, 12);
}
