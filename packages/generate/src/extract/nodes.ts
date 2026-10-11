import { isMap, isNode, isScalar, isSeq, type Pair, type YAMLMap } from 'yaml';

/**
 * Small readers over a parsed YAML (or JSON) document that keep source positions, so the code pre-pass can
 * quote the exact text an entry comes from.
 */

/** The text of a node, as written in the source, without trailing white space. */
export function nodeText(text: string, node: unknown): string | undefined {
  const range = isNode(node) ? node.range : undefined;
  return range ? excerpt(text, range[0], range[1]) : undefined;
}

/** The text of a pair, `key: value`, as written in the source. */
export function pairText(text: string, pair: Pair | undefined): string | undefined {
  const key = pair && isNode(pair.key) ? pair.key : undefined;
  const value = pair && isNode(pair.value) ? pair.value : undefined;
  const start = key?.range?.[0];
  const end = (value ?? key)?.range?.[1];
  return start === undefined || end === undefined ? undefined : excerpt(text, start, end);
}

/**
 * The source text from `start` to `end`. Lines after the first lose the indentation the first line had in
 * the file, so a nested item reads as it would on its own. The words stay as written: a quote check folds
 * white space, so the excerpt is still found in its source.
 */
function excerpt(text: string, start: number, end: number): string {
  const column = start - (text.lastIndexOf('\n', start - 1) + 1);
  return text
    .slice(start, end)
    .trimEnd()
    .split('\n')
    .map((line, index) => {
      if (index === 0) return line;
      const indent = line.length - line.trimStart().length;
      return line.slice(Math.min(column, indent));
    })
    .join('\n');
}

/** The pair of a mapping with this key, compared as a string. */
export function entry(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined;
  return map.items.find((pair) => keyOf(pair) === key) as Pair | undefined;
}

/** The key of a pair as a string, when it is a scalar. */
export function keyOf(pair: Pair): string | undefined {
  const key = pair.key as unknown;
  if (isScalar(key)) return String(key.value);
  return typeof key === 'string' ? key : undefined;
}

/** The mapping under a key, if it is one. */
export function mapAt(map: unknown, key: string): YAMLMap | undefined {
  const value = entry(map, key)?.value;
  return isMap(value) ? value : undefined;
}

/** A node as plain data. */
export function plain(node: unknown): unknown {
  if (node && typeof node === 'object' && 'toJSON' in node && typeof node.toJSON === 'function') {
    return node.toJSON();
  }
  return node;
}

/** The string items of a sequence node, ignoring anything else. */
export function stringItems(node: unknown): string[] {
  if (!isSeq(node)) return [];
  return node.items.flatMap((item) => (isScalar(item) && typeof item.value === 'string' ? [item.value] : []));
}
