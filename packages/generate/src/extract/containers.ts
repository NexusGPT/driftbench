/**
 * A prompt kept inside another file: a JSON chat file, an agent export, JSON lines, a YAML scalar, a string in
 * code. The model reads the prompt itself, so a request shows the text the container holds, decoded, instead
 * of the file's escapes and syntax. A quote taken from that text is still a quote of the file's prompt:
 * `sourceTexts` keeps both the file and its decoded text, and a quote is found in either.
 */

type View = (text: string) => string | undefined;

/** Every string a JSON value holds, in order, longest container first is not needed: the file order is kept. */
function strings(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value)) strings(item, out);
  return out;
}

const json: View = (text) => {
  try {
    return strings(JSON.parse(text), []).join('\n\n');
  } catch {
    return undefined;
  }
};

const jsonLines: View = (text) => {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      strings(JSON.parse(line), out);
    } catch {
      return undefined;
    }
  }
  return out.join('\n');
};

const VIEWS: Array<[RegExp, View]> = [
  [/\.jsonl$/i, jsonLines],
  [/\.json$/i, json],
];

/** The text a container file holds, decoded; undefined when the file is no container or is unreadable as one. */
export function promptView(path: string, text: string): string | undefined {
  for (const [pattern, view] of VIEWS) {
    if (!pattern.test(path)) continue;
    const decoded = view(text);
    return decoded !== undefined && decoded !== text ? decoded : undefined;
  }
  return undefined;
}

/** The sources as a model reads them: a container file shows its decoded text. */
export function viewSources<T extends { kind: string; path: string; text: string }>(
  sources: readonly T[],
): T[] {
  return sources.map((source) => {
    const view = source.kind === 'prompt' ? promptView(source.path, source.text) : undefined;
    return view === undefined ? source : { ...source, text: view };
  });
}

/** The text a quote of a source is checked against: the file, and its decoded text when it is a container. */
export function sourceTexts<T extends { kind: string; path: string; text: string }>(
  sources: readonly T[],
): Map<string, string> {
  return new Map(
    sources.map((source) => {
      const view = source.kind === 'prompt' ? promptView(source.path, source.text) : undefined;
      return [source.path, view === undefined ? source.text : `${source.text}\n${view}`];
    }),
  );
}
