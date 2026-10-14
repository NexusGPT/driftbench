import { Document, isScalar, type ScalarTag } from 'yaml';

// The ordinary block-map/sequence subset needs no CST or YAML node tree. Anything
// outside this subset goes through the existing YAML parser, including its errors.
const scalarTags = new Document().schema.tags.filter(
  (tag): tag is ScalarTag => !tag.collection && tag.default === true && tag.test !== undefined,
);
const unsupported = Symbol('unsupported YAML');
// Primitive scalar results are immutable; keep at most 4096 short spellings.
const scalarValues = new Map<string, unknown>();
const plainKey = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

export function parseBlockYaml(text: string): { value: unknown } | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters require the full YAML parser.
  if (/[\r\t\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text)) return;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let at = 0;
  const indentation = (line: string) => line.match(/^ */)?.[0].length ?? 0;
  const skip = () => {
    while (at < lines.length && (/^ *#/.test(lines[at] ?? '') || /^ *$/.test(lines[at] ?? ''))) at += 1;
  };
  const rawScalar = (source: string): unknown => {
    if (source === '{}') return {};
    if (source === '[]') return [];
    if (source.startsWith('"')) {
      const value: unknown = JSON.parse(source);
      if (typeof value !== 'string') throw unsupported;
      return value;
    }
    if (source.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(source)) throw unsupported;
      return source.slice(1, -1).replaceAll("''", "'");
    }
    if (
      source.length === 0 ||
      source.trim() !== source ||
      /^[!&*#{}[\],>|%@`]/.test(source) ||
      /^[?:-](?: |$)/.test(source) ||
      /:($| )| #/.test(source) ||
      source === '---' ||
      source === '...'
    )
      throw unsupported;
    for (const tag of scalarTags) {
      if (tag.test?.test(source)) {
        const resolved = tag.resolve(
          source,
          () => {
            throw unsupported;
          },
          {},
        );
        return isScalar(resolved) ? resolved.value : resolved;
      }
    }
    return source;
  };
  const scalar = (source: string): unknown => {
    const known = scalarValues.get(source);
    if (known !== undefined) return known;
    const result = rawScalar(source);
    if (source.length <= 256 && (result === null || typeof result !== 'object')) {
      if (scalarValues.size >= 4096) scalarValues.clear();
      scalarValues.set(source, result);
    }
    return result;
  };
  const pair = (source: string): [string, string] => {
    // Complex/quoted keys are uncommon and retain the full parser's handling.
    const colon = source.indexOf(':');
    const key = source.slice(0, colon);
    if (colon < 1 || !plainKey.test(key) || (source[colon + 1] !== undefined && source[colon + 1] !== ' '))
      throw unsupported;
    if (typeof scalar(key) !== 'string') throw unsupported;
    return [key, source.slice(colon + 1).replace(/^ /, '')];
  };
  const literal = (source: string, indent: number): string => {
    if ((source !== '|-' && source !== '|') || !text.endsWith('\n')) throw unsupported;
    const content: string[] = [];
    let first = true;
    while (at < lines.length) {
      const line = lines[at] ?? '';
      if (line !== '' && indentation(line) <= indent) break;
      if (line !== '' && indentation(line) < indent + 2) throw unsupported;
      if (line !== '' && (line.trim() === '' || (first && indentation(line) !== indent + 2)))
        throw unsupported;
      if (line !== '') first = false;
      content.push(line.slice(indent + 2));
      at += 1;
    }
    if (content.length === 0 || first) throw unsupported;
    const value = content.join('\n').replace(/\n*$/, '');
    return source === '|' ? `${value}\n` : value;
  };
  const value = (source: string, indent: number): unknown => {
    if (source.startsWith('|')) return literal(source, indent);
    if (source !== '') return scalar(source);
    skip();
    const line = lines[at];
    if (line === undefined || indentation(line) !== indent + 2) throw unsupported;
    return block(indent + 2);
  };
  const map = (indent: number, first?: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    let source = first;
    while (true) {
      if (source === undefined) {
        skip();
        const line = lines[at];
        if (line === undefined || indentation(line) < indent) break;
        if (indentation(line) !== indent || line.slice(indent).startsWith('- ')) throw unsupported;
        source = line.slice(indent);
        at += 1;
      }
      const [key, rest] = pair(source);
      if (Object.hasOwn(out, key)) throw unsupported;
      const parsed = value(rest, indent);
      if (key === '__proto__')
        Object.defineProperty(out, key, {
          value: parsed,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else out[key] = parsed;
      source = undefined;
    }
    return out;
  };
  const sequence = (indent: number, first?: string): unknown[] => {
    const out: unknown[] = [];
    let source = first;
    while (true) {
      if (source === undefined) {
        skip();
        const line = lines[at];
        if (line === undefined || indentation(line) < indent) break;
        if (indentation(line) !== indent || !line.slice(indent).startsWith('- ')) throw unsupported;
        source = line.slice(indent);
        at += 1;
      }
      const rest = source.slice(2);
      if (rest.startsWith('- ')) out.push(sequence(indent + 2, rest));
      else if (/^[a-zA-Z_][a-zA-Z0-9_.-]*:(?: |$)/.test(rest)) out.push(map(indent + 2, rest));
      else out.push(value(rest, indent));
      source = undefined;
    }
    return out;
  };
  const block = (indent: number): unknown => {
    const source = (lines[at] ?? '').slice(indent);
    return source.startsWith('- ') ? sequence(indent) : map(indent);
  };
  try {
    skip();
    if (at === lines.length || indentation(lines[at] ?? '') !== 0) return;
    const result = block(0);
    skip();
    if (at !== lines.length) return;
    return { value: result };
  } catch {
    return;
  }
}
