import { Document, Scalar, stringify } from 'yaml';

// Reuse the public YAML node/document API for scalar spellings without rebuilding its schema.
const scalarNode = new Scalar<unknown>('');
const scalarDocument = new Document({ v: scalarNode });

const options = { lineWidth: 0, aliasDuplicateObjects: false };
const unsupported = Symbol('unsupported YAML value');
const scalars = new Map<unknown, string>();
const keys = new Map<string, string>();
const negativeZero = Symbol('-0');
let cachedCharacters = 0;

/** Bounded scalar text reuse, independent of the number of specs emitted. */
function scalar(value: unknown): string {
  const type = typeof value;
  if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') throw unsupported;
  const key = Object.is(value, -0) ? negativeZero : value;
  const known = scalars.get(key);
  if (known !== undefined) return known;
  scalarNode.value = value;
  const text = scalarDocument.toString(options).slice(3, -1);
  // Chomping and blank lines between following nodes remain the library's job.
  if (text.includes('\n')) throw unsupported;
  if (text.length > 16_384) return text;
  if (scalars.size >= 4096 || cachedCharacters + text.length > 1_000_000) {
    scalars.clear();
    cachedCharacters = 0;
  }
  scalars.set(key, text);
  cachedCharacters += text.length;
  return text;
}

function keyText(key: string): string {
  const known = keys.get(key);
  if (known !== undefined) return known;
  const text = stringify({ [key]: null }, options);
  if (!text.endsWith(': null\n') || (text.includes('\n', 0) && text.indexOf('\n') !== text.length - 1))
    throw unsupported;
  const result = text.slice(0, -7);
  if (keys.size >= 4096) keys.clear();
  if (key.length <= 128) keys.set(key, result);
  return result;
}

/** The library's block style for plain objects and arrays, with its scalar spellings. */
export function stringifyGeneratedYaml(input: unknown): string {
  const seen = new Set<object>();
  const lines: string[] = [];
  const render = (value: unknown, indent: number, prefix: string, mappingValue = false): void => {
    if (value === null || typeof value !== 'object') {
      lines.push(`${prefix}${scalar(value)}`);
      return;
    }
    if (seen.has(value) || indent > 100) throw unsupported;
    seen.add(value);
    try {
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        throw unsupported;
      const toJSON = Object.getOwnPropertyDescriptor(value, 'toJSON');
      if (toJSON?.get || toJSON?.set || typeof toJSON?.value === 'function') throw unsupported;
      const names = Object.keys(value);
      // Sparse or decorated arrays retain the YAML library's treatment.
      if (array && names.length !== value.length) throw unsupported;
      let kept = 0;
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string;
        if (array && name !== String(index)) throw unsupported;
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor?.get || descriptor?.set) throw unsupported;
        if (array || (value as Record<string, unknown>)[name] !== undefined) names[kept++] = name;
      }
      names.length = kept;
      const entries = names;
      if (entries.length === 0) {
        lines.push(`${prefix}${array ? '[]' : '{}'}`);
        return;
      }
      if (mappingValue) {
        lines.push(prefix.slice(0, -1));
        prefix = ' '.repeat(indent);
      }
      const pad = ' '.repeat(indent);
      if (array) {
        for (let index = 0; index < value.length; index += 1)
          render(value[index], indent + 2, `${index === 0 ? prefix : pad}- `);
      } else {
        for (let index = 0; index < entries.length; index += 1) {
          const key = entries[index] as string;
          render(
            (value as Record<string, unknown>)[key],
            indent + 2,
            `${index === 0 ? prefix : pad}${keyText(key)}: `,
            true,
          );
        }
      }
    } finally {
      seen.delete(value);
    }
  };
  try {
    if (input === null || typeof input !== 'object') throw unsupported;
    render(input, 0, '');
    return `${lines.join('\n')}\n`;
  } catch {
    return stringify(input, options);
  }
}
