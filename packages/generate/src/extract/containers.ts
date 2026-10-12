import { isScalar, parseDocument, visit } from 'yaml';

/**
 * A prompt kept inside another file: a JSON chat file, an agent export, JSON lines, a YAML scalar, a string in
 * code. The model reads the prompt itself, so a request shows the text the container holds, decoded, instead
 * of the file's escapes and syntax. An entry must quote the file as it is written, so a quote the model gives
 * from the decoded text is mapped back to the passage of the file it was decoded from (`rawizeAnswer`).
 */

/** A decoded text with, for each character, the span of the file it came from (-1 where it has none). */
export type View = { text: string; starts: number[]; ends: number[] };

class ViewBuilder {
  text = '';
  starts: number[] = [];
  ends: number[] = [];

  /** A character the file writes from `start` to `end`. */
  char(value: string, start: number, end: number): void {
    this.text += value;
    for (let i = 0; i < value.length; i++) {
      this.starts.push(start);
      this.ends.push(end);
    }
  }

  /** Text the file does not hold (a separator between strings). */
  gap(value: string): void {
    this.text += value;
    for (let i = 0; i < value.length; i++) {
      this.starts.push(-1);
      this.ends.push(-1);
    }
  }

  build(): View {
    return { text: this.text, starts: this.starts, ends: this.ends };
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * The string values of a JSON text (keys are left out), decoded, each followed by `separator`, with the file
 * span of every decoded character. Undefined when a string is not closed.
 */
function jsonStrings(raw: string, separator: string, into = new ViewBuilder()): ViewBuilder | undefined {
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '"') {
      i++;
      continue;
    }
    const from = into.text.length;
    i++;
    let closed = false;
    const pending: Array<[string, number, number]> = [];
    while (i < raw.length) {
      const c = raw[i] as string;
      if (c === '"') {
        closed = true;
        i++;
        break;
      }
      if (c === '\\') {
        const e = raw[i + 1] ?? '';
        if (e === 'u') {
          const code = Number.parseInt(raw.slice(i + 2, i + 6), 16);
          if (Number.isNaN(code)) return undefined;
          pending.push([String.fromCharCode(code), i, i + 6]);
          i += 6;
        } else if (e in SIMPLE_ESCAPES) {
          pending.push([SIMPLE_ESCAPES[e] as string, i, i + 2]);
          i += 2;
        } else return undefined;
      } else {
        pending.push([c, i, i + 1]);
        i++;
      }
    }
    if (!closed) return undefined;
    let next = i;
    while (raw[next] === ' ' || raw[next] === '\n' || raw[next] === '\r' || raw[next] === '\t') next++;
    if (raw[next] === ':') continue; // a key
    for (const [value, start, end] of pending) into.char(value, start, end);
    if (into.text.length > from) into.gap(separator);
  }
  return into;
}

function jsonView(raw: string): View | undefined {
  try {
    JSON.parse(raw);
  } catch {
    return undefined;
  }
  return jsonStrings(raw, '\n\n')?.build();
}

function jsonLinesView(raw: string): View | undefined {
  const builder = new ViewBuilder();
  let offset = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() !== '') {
      try {
        JSON.parse(line);
      } catch {
        return undefined;
      }
      const part = jsonStrings(line, '\n');
      if (!part) return undefined;
      part.text.split('').forEach((value, index) => {
        const start = part.starts[index] as number;
        const end = part.ends[index] as number;
        if (start < 0) builder.gap(value);
        else builder.char(value, start + offset, end + offset);
      });
    }
    offset += line.length + 1;
  }
  return builder.build();
}

/** A token of the file and the characters it stands for, each with the span of the token it comes from. */
type Token = { start: number; end: number; chars: Array<[string, number, number]> };

/** The file with each token replaced by what it stands for; text outside the tokens is kept as it is. */
function inPlace(raw: string, tokens: Token[]): View {
  const builder = new ViewBuilder();
  let at = 0;
  for (const token of [...tokens].sort((a, b) => a.start - b.start)) {
    if (token.start < at) continue;
    for (let i = at; i < token.start; i++) builder.char(raw[i] as string, i, i + 1);
    for (const [value, start, end] of token.chars) builder.char(value, start, end);
    at = token.end;
  }
  for (let i = at; i < raw.length; i++) builder.char(raw[i] as string, i, i + 1);
  return builder.build();
}

const YAML_ESCAPES: Record<string, string> = {
  ...SIMPLE_ESCAPES,
  '0': '\0',
  a: '\x07',
  e: '\x1b',
  v: '\v',
  N: '\u0085',
  _: '\u00a0',
  ' ': ' ',
};

/** The content of a YAML double-quoted scalar from `from` to `to` (the quotes excluded), escapes decoded. */
function yamlDouble(raw: string, from: number, to: number): Array<[string, number, number]> | undefined {
  const out: Array<[string, number, number]> = [];
  let i = from;
  while (i < to) {
    const c = raw[i] as string;
    if (c !== '\\') {
      out.push([c, i, i + 1]);
      i++;
      continue;
    }
    const e = raw[i + 1] ?? '';
    const hex = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
    if (hex > 0) {
      const code = Number.parseInt(raw.slice(i + 2, i + 2 + hex), 16);
      if (Number.isNaN(code)) return undefined;
      for (const unit of String.fromCodePoint(code)) out.push([unit, i, i + 2 + hex]);
      i += 2 + hex;
    } else if (e in SIMPLE_ESCAPES) {
      out.push([SIMPLE_ESCAPES[e] as string, i, i + 2]);
      i += 2;
    } else if (e in YAML_ESCAPES) {
      out.push([JSON.parse(`"${YAML_ESCAPES[e]}"`) as string, i, i + 2]);
      i += 2;
    } else return undefined;
  }
  return out;
}

/** Quoted scalars of a YAML file, decoded: `\n`, `\"`, `\uXXXX` in double quotes, '' in single quotes. */
function yamlView(raw: string): View | undefined {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return undefined;
  const tokens: Token[] = [];
  visit(doc, {
    Scalar(_key, node) {
      if ((node.type !== 'QUOTE_DOUBLE' && node.type !== 'QUOTE_SINGLE') || !node.range) return;
      const [start, , end] = node.range;
      const open = raw[start];
      if (open !== '"' && open !== "'") return;
      let close = end;
      while (close > start + 1 && raw[close - 1] !== open) close--;
      if (close <= start + 1 && raw[start + 1] !== open) return;
      const inner = [start + 1, close - 1] as const;
      let chars: Array<[string, number, number]> | undefined;
      if (open === '"') chars = yamlDouble(raw, inner[0], inner[1]);
      else {
        chars = [];
        for (let i = inner[0]; i < inner[1]; i++) {
          if (raw[i] === "'" && raw[i + 1] === "'") {
            chars.push(["'", i, i + 2]);
            i++;
          } else chars.push([raw[i] as string, i, i + 1]);
        }
      }
      if (chars) tokens.push({ start, end: close, chars });
    },
  });
  return tokens.length === 0 ? undefined : inPlace(raw, tokens);
}

const VIEWS: Array<[RegExp, (raw: string) => View | undefined]> = [
  [/\.jsonl$/i, jsonLinesView],
  [/\.json$/i, jsonView],
  [/\.ya?ml$/i, yamlView],
];

/** The text a container file holds, decoded; undefined when the file is no container or is unreadable as one. */
export function promptView(path: string, raw: string): View | undefined {
  for (const [pattern, view] of VIEWS) {
    if (!pattern.test(path)) continue;
    const decoded = view(raw);
    return decoded && decoded.text !== raw ? decoded : undefined;
  }
  return undefined;
}

type Source = { kind: string; path: string; text: string };

/** The sources as a model reads them: a container file shows its decoded text. */
export function viewSources<T extends Source>(sources: readonly T[]): T[] {
  return sources.map((source) => {
    const view = source.kind === 'prompt' ? promptView(source.path, source.text) : undefined;
    return view ? { ...source, text: view.text } : source;
  });
}

const fold = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The passage of the file a decoded quote comes from, or the quote itself when the source is no container or
 * the quote is not in the decoded text.
 */
export function rawQuote(sources: readonly Source[], source: string, quote: string): string {
  const file = sources.find((candidate) => candidate.path === source && candidate.kind === 'prompt');
  const view = file ? promptView(file.path, file.text) : undefined;
  if (!file || !view) return quote;
  let at = view.text.indexOf(quote);
  let length = quote.length;
  if (at < 0) {
    // The model folded white space: match on a version of the decoded text without runs of white space.
    const needle = fold(quote);
    const map: number[] = [];
    let folded = '';
    for (let i = 0; i < view.text.length; i++) {
      const space = /\s/.test(view.text[i] as string);
      if (space && (folded === '' || folded.endsWith(' '))) continue;
      folded += space ? ' ' : (view.text[i] as string);
      map.push(i);
    }
    const found = folded.indexOf(needle);
    if (found < 0 || needle === '') return quote;
    at = map[found] as number;
    length = (map[found + needle.length - 1] as number) - at + 1;
  }
  // An entry's quote must be in the file as written and in the prompt as decoded: the longest passage of the
  // quote whose characters the file writes as they are (no escape, no gap).
  let best = '';
  let run = '';
  const flush = () => {
    if (run.trim().length > best.trim().length) best = run;
    run = '';
  };
  for (let i = at; i < at + length; i++) {
    const start = view.starts[i] ?? -1;
    const plain = start >= 0 && (view.ends[i] ?? -1) - start === 1 && file.text[start] === view.text[i];
    if (plain) run += view.text[i];
    else flush();
  }
  flush();
  const passage = best.trim();
  if (passage === '') return quote;
  return passage.length > 1000 ? passage.slice(0, 1000).trimEnd() : passage;
}

/** Every `quote` of an answer, beside a `source` or inside an `evidence`, mapped back to the file. */
export function rawizeAnswer<T>(answer: T, sources: readonly Source[]): T {
  const walk = (node: unknown, source?: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, source));
    if (node === null || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    const here = typeof record.source === 'string' ? record.source : source;
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) =>
        key === 'quote' && typeof value === 'string' && here !== undefined
          ? [key, rawQuote(sources, here, value)]
          : [key, walk(value, here)],
      ),
    );
  };
  return walk(answer) as T;
}
