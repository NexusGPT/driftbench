import { Document, stringify } from 'yaml';
import { type StringifyContext, stringifyString } from 'yaml/util';

const options = { lineWidth: 0, aliasDuplicateObjects: false };
// Ask the public custom-tag API for the library's ordinary block-value context once. Scalar
// formatting then uses its public utility directly, without constructing a mapping for every string.
let scalarContext: StringifyContext;
const scalarDocument = new Document(
  { v: '' },
  {
    customTags: (tags) =>
      tags.map((tag) =>
        typeof tag !== 'string' && !tag.collection && tag.tag === 'tag:yaml.org,2002:str'
          ? {
              ...tag,
              stringify(item, context, onComment, onChompKeep) {
                const ctx = { actualString: true, ...context };
                if (!ctx.implicitKey) scalarContext = ctx;
                return stringifyString(item, ctx, onComment, onChompKeep);
              },
            }
          : tag,
      ),
  },
);
scalarDocument.toString(options);

const unsupported = Symbol('unsupported YAML value');
const scalars = new Map<string, string>();
const keys = new Map<string, string>();
const plainText = /^[A-Za-z_](?:[A-Za-z0-9_. -]*[A-Za-z0-9_.-])?$/;
const reserved = new Set(['null', 'Null', 'NULL', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE']);
let cachedCharacters = 0;

/** Bounded scalar text reuse, independent of the number of specs emitted. */
function scalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan';
    if (!Number.isFinite(value)) return value < 0 ? '-.inf' : '.inf';
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (typeof value !== 'string') throw unsupported;
  // These ASCII strings cannot be indicators, document markers, numbers or quoted scalars.
  if (plainText.test(value) && !reserved.has(value)) return value;
  const known = scalars.get(value);
  if (known !== undefined) return known;
  const text = stringifyString({ value }, scalarContext);
  // Chomping and blank lines between following nodes remain the library's job.
  if (text.includes('\n')) throw unsupported;
  if (text.length > 16_384) return text;
  if (scalars.size >= 4096 || cachedCharacters + text.length > 1_000_000) {
    scalars.clear();
    cachedCharacters = 0;
  }
  scalars.set(value, text);
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

const padding = Array.from({ length: 103 }, (_, index) => ' '.repeat(index));

/** The library's block style for plain objects and arrays, with its scalar spellings. */
export function stringifyGeneratedYaml(input: unknown, plain?: ReadonlySet<object>): string {
  let text = '';
  const render = (value: object, indent: number, prefix: string, mappingValue = false): void => {
    // The depth cap also sends cycles to the library, which owns their diagnostics.
    if (indent > 100) throw unsupported;
    const array = Array.isArray(value);
    const trusted = plain?.has(value) === true;
    let names: string[] = [];
    if (!trusted) {
      const prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        throw unsupported;
      const toJSON = Object.getOwnPropertyDescriptor(value, 'toJSON');
      if (toJSON?.get || toJSON?.set || typeof toJSON?.value === 'function') throw unsupported;
      names = Object.keys(value);
      if (array && names.length !== value.length) throw unsupported;
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string;
        if (array && name !== String(index)) throw unsupported;
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor?.get || descriptor?.set) throw unsupported;
      }
    } else if (!array) names = Object.keys(value);
    if (!array) {
      let kept = 0;
      for (const name of names)
        if ((value as Record<string, unknown>)[name] !== undefined) names[kept++] = name;
      names.length = kept;
    }
    const length = array ? value.length : names.length;
    if (length === 0) {
      text += `${prefix}${array ? '[]' : '{}'}\n`;
      return;
    }
    if (mappingValue) {
      text += `${prefix.slice(0, -1)}\n`;
      prefix = padding[indent] as string;
    }
    const pad = padding[indent] as string;
    if (array) {
      for (let index = 0; index < length; index += 1) {
        const child: unknown = value[index];
        const lead = `${index === 0 ? prefix : pad}- `;
        if (child !== null && typeof child === 'object') render(child, indent + 2, lead);
        else text += `${lead}${scalar(child)}\n`;
      }
    } else {
      for (let index = 0; index < length; index += 1) {
        const key = names[index] as string;
        const child = (value as Record<string, unknown>)[key];
        const lead = `${index === 0 ? prefix : pad}${keyText(key)}: `;
        if (child !== null && typeof child === 'object') render(child, indent + 2, lead, true);
        else text += `${lead}${scalar(child)}\n`;
      }
    }
  };
  try {
    if (input === null || typeof input !== 'object') throw unsupported;
    render(input, 0, '');
    return text;
  } catch {
    return stringify(input, options);
  }
}
