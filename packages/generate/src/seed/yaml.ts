import { stringify } from 'yaml';

const options = { lineWidth: 0, aliasDuplicateObjects: false };
const unsupported = Symbol('unsupported YAML value');
const scalars = new Map<unknown, string>();
const keys = new Map<string, string>();
const negativeZero = Symbol('-0');
let cachedCharacters = 0;

/** Bounded scalar text reuse, independent of the number of specs emitted. */
function scalar(value: unknown): string {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw unsupported;
  const key = Object.is(value, -0) ? negativeZero : value;
  const known = scalars.get(key);
  if (known !== undefined) return known;
  const text = stringify({ v: value }, options).slice(3, -1);
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
  const render = (value: unknown, indent: number): string[] => {
    const pad = ' '.repeat(indent);
    if (value === null || typeof value !== 'object') return [`${pad}${scalar(value)}`];
    if (seen.has(value) || indent > 100) throw unsupported;
    seen.add(value);
    try {
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw unsupported;
      if (typeof Object.getOwnPropertyDescriptor(value, 'toJSON')?.value === 'function') throw unsupported;
      if (
        Object.values(Object.getOwnPropertyDescriptors(value)).some(
          (descriptor) => descriptor.get || descriptor.set,
        )
      )
        throw unsupported;
      const entries = Array.isArray(value)
        ? value.map((item) => [undefined, item] as const)
        : Object.entries(value).filter(([, item]) => item !== undefined);
      if (entries.length === 0) return [`${pad}${Array.isArray(value) ? '[]' : '{}'}`];
      const out: string[] = [];
      for (const [key, item] of entries) {
        const child = render(item, indent + 2);
        const first = (child[0] ?? '').slice(indent + 2);
        if (key === undefined) {
          out.push(`${pad}- ${first}`, ...child.slice(1));
        } else if (item !== null && typeof item === 'object' && first !== '{}' && first !== '[]') {
          out.push(`${pad}${keyText(key)}:`, ...child);
        } else {
          out.push(`${pad}${keyText(key)}: ${first}`, ...child.slice(1));
        }
      }
      return out;
    } finally {
      seen.delete(value);
    }
  };
  try {
    if (input === null || typeof input !== 'object') throw unsupported;
    return `${render(input, 0).join('\n')}\n`;
  } catch {
    return stringify(input, options);
  }
}
