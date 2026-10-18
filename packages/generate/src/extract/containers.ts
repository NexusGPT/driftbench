import { parseDocument, visit } from 'yaml';

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
    const open = i;
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
    // Strings that label a message (its role, its part type) are not prompt text.
    const label = /"(type|role|name|model|id|object|lang|language)"\s*:\s*$/.exec(
      raw.slice(Math.max(0, open - 24), open),
    );
    if (label) continue;
    for (const [value, start, end] of pending) into.char(value, start, end);
    // The parts of a message (`{ "type": "text", "text": "..." }`) run on without a break between them.
    const key = /"text"\s*:\s*$/.test(raw.slice(Math.max(0, open - 20), open));
    if (into.text.length > from && !key) into.gap(separator);
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

type Language = {
  line: string[];
  block: boolean;
  phpSingle?: boolean;
  templates?: boolean;
  swift?: boolean;
  /** SQL: a string is '...' and a doubled quote stands for one. */
  sql?: boolean;
};
const LANGUAGES: Array<[RegExp, Language]> = [
  [/\.swift$/i, { line: ['//'], block: true, swift: true }],
  [/\.(ts|tsx|js|jsx|mjs|cjs|json5|go|java|cs|kt|rs)$/i, { line: ['//'], block: true, templates: true }],
  [/\.php$/i, { line: ['//', '#'], block: true, phpSingle: true }],
  [/\.py$/i, { line: ['#'], block: false, templates: true }],
  [/(\.toml|\.env|(^|\/)\.env\.[\w.]+)$/i, { line: ['#'], block: false }],
  [/\.sql$/i, { line: ['--'], block: true, sql: true }],
];

const CODE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '`': '`',
  '/': '/',
};

/** The numbers and strings a file assigns to a name (`const MAX = 3;`, `MAX = 3`). */
function constantsOf(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern =
    /^\s*(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*')\s*;?\s*$/gm;
  for (const match of raw.matchAll(pattern)) {
    const value = match[2] as string;
    out.set(match[1] as string, /^["']/.test(value) ? value.slice(1, -1) : value);
  }
  return out;
}

/**
 * The content of a template literal (`${NAME}`) or a Python f-string (`{NAME}`) from `from` to `to`: escapes
 * decoded, and a name the file assigns a number or a string replaced by its value.
 */
function template(
  raw: string,
  from: number,
  to: number,
  style: 'js' | 'py' | 'swift',
  constants: Map<string, string>,
): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  const open = style === 'js' ? '${' : style === 'swift' ? '\\(' : '{';
  const closer = style === 'swift' ? ')' : '}';
  let i = from;
  while (i < to) {
    const c = raw[i] as string;
    if (c === '\\' && !(style === 'swift' && raw.startsWith(open, i))) {
      const e = raw[i + 1] ?? '';
      out.push([(CODE_ESCAPES[e] ?? e) as string, i, i + 2]);
      i += 2;
    } else if (style === 'py' && (raw.startsWith('{{', i) || raw.startsWith('}}', i))) {
      out.push([c, i, i + 2]);
      i += 2;
    } else if (raw.startsWith(open, i)) {
      const close = raw.indexOf(closer, i);
      const name = close < 0 ? '' : raw.slice(i + open.length, close).trim();
      const value = constants.get(name);
      if (close < 0 || value === undefined) {
        out.push([c, i, i + 1]);
        i++;
      } else {
        for (const unit of value) out.push([unit, i, close + 1]);
        i = close + 1;
      }
    } else {
      out.push([c, i, i + 1]);
      i++;
    }
  }
  return out;
}

/** A string literal in code, `'...'` or `"..."`, with backslash escapes decoded; comments and raw strings are skipped. */
function codeView(raw: string, language: Language): View | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i] as string;
    const two = raw.slice(i, i + 2);
    const lineComment = language.line.find((marker) => raw.startsWith(marker, i));
    if (lineComment) {
      const end = raw.indexOf('\n', i);
      i = end < 0 ? raw.length : end;
      continue;
    }
    if (language.block && two === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end < 0 ? raw.length : end + 2;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== '`') j += raw[j] === '\\' ? 2 : 1;
      if (language.templates && j < raw.length)
        tokens.push({ start: i, end: j + 1, chars: template(raw, i + 1, j, 'js', constantsOf(raw)) });
      i = j + 1;
      continue;
    }
    if ((c === '"' || c === "'") && raw.startsWith(c.repeat(3), i)) {
      const end = raw.indexOf(c.repeat(3), i + 3);
      if (language.templates && /[fF]$/.test(raw.slice(Math.max(0, i - 1), i)) && end > 0)
        tokens.push({ start: i, end: end + 3, chars: template(raw, i + 3, end, 'py', constantsOf(raw)) });
      else if (language.swift && c === '"' && end > 0)
        tokens.push({ start: i, end: end + 3, chars: template(raw, i + 3, end, 'swift', constantsOf(raw)) });
      i = end < 0 ? raw.length : end + 3;
      continue;
    }
    if (c === 'r' && /^r#*"/.test(raw.slice(i, i + 8)) && !/\w/.test(raw[i - 1] ?? ' ')) {
      const hashes = /^r(#*)"/.exec(raw.slice(i, i + 8))?.[1] ?? '';
      const end = raw.indexOf(`"${hashes}`, i + 2 + hashes.length);
      i = end < 0 ? raw.length : end + 1 + hashes.length;
      continue;
    }
    if ((c === '@' && raw[i + 1] === '"') || (language.sql && c === "'")) {
      // A verbatim string (C#) or an SQL string: a doubled quote stands for one quote.
      const quote = language.sql ? "'" : '"';
      const chars: Array<[string, number, number]> = [];
      let j = i + (language.sql ? 1 : 2);
      while (j < raw.length) {
        if (raw[j] === quote && raw[j + 1] === quote) {
          chars.push([quote, j, j + 2]);
          j += 2;
        } else if (raw[j] === quote) break;
        else {
          chars.push([raw[j] as string, j, j + 1]);
          j++;
        }
      }
      if (j < raw.length) tokens.push({ start: i, end: j + 1, chars });
      i = j + 1;
      continue;
    }
    if (c !== '"' && c !== "'") {
      i++;
      continue;
    }
    const chars: Array<[string, number, number]> = [];
    let j = i + 1;
    let closed = false;
    while (j < raw.length && (raw[j] !== '\n' || language.phpSingle)) {
      const d = raw[j] as string;
      if (d === c) {
        closed = true;
        break;
      }
      if (d !== '\\') {
        chars.push([d, j, j + 1]);
        j++;
        continue;
      }
      const e = raw[j + 1] ?? '';
      if (language.phpSingle && c === "'") {
        if (e === '\\' || e === "'") chars.push([e, j, j + 2]);
        else chars.push(['\\', j, j + 1], [e, j + 1, j + 2]);
        j += 2;
      } else if (e === 'x' || e === 'u') {
        const braced = e === 'u' && raw[j + 2] === '{' ? raw.indexOf('}', j) : -1;
        const digits = braced > 0 ? raw.slice(j + 3, braced) : raw.slice(j + 2, j + 2 + (e === 'x' ? 2 : 4));
        const end = braced > 0 ? braced + 1 : j + 2 + digits.length;
        const code = Number.parseInt(digits, 16);
        if (Number.isNaN(code)) break;
        for (const unit of String.fromCodePoint(code)) chars.push([unit, j, end]);
        j = end;
      } else if (e in CODE_ESCAPES) {
        chars.push([CODE_ESCAPES[e] as string, j, j + 2]);
        j += 2;
      } else {
        chars.push([e, j, j + 2]);
        j += 2;
      }
    }
    if (closed) {
      tokens.push({
        start: i,
        end: j + 1,
        chars: [[c, i, i + 1], ...chars, [c, j, j + 1]].slice(1, -1) as Array<[string, number, number]>,
      });
      i = j + 1;
    } else i++;
  }
  // Literals joined with + or only separated by white space are one string: `"a" +\n "b"` reads as `ab`.
  const joined: Token[] = [];
  for (const token of tokens) {
    const last = joined[joined.length - 1];
    if (last && /^\s*\+?\s*$/.test(raw.slice(last.end, token.start))) {
      joined[joined.length - 1] = {
        start: last.start,
        end: token.end,
        chars: [...last.chars, ...token.chars],
      };
    } else joined.push(token);
  }
  const changes = (token: Token) =>
    token.chars.length !== token.end - token.start - 2 ||
    token.chars.some(([value, start, end]) => end - start !== 1 || raw[start] !== value);
  return joined.some(changes) ? inPlace(raw, joined) : undefined;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
  ndash: '\u2013',
  mdash: '\u2014',
};

/** HTML or XML: entities decoded, and for HTML the tags dropped (a `<br>` is a line break). */
function markupView(raw: string, html: boolean): View | undefined {
  const tokens: Token[] = [];
  if (html) {
    for (const match of raw.matchAll(
      /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>|<\/?[A-Za-z][^<>]*>|<!doctype[^>]*>/gi,
    )) {
      const start = match.index as number;
      const end = start + match[0].length;
      const isBreak = /^<br\b/i.test(match[0]);
      tokens.push({ start, end, chars: isBreak ? [['\n', start, end]] : [] });
    }
  }
  for (const match of raw.matchAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi)) {
    const start = match.index as number;
    if (tokens.some((token) => start >= token.start && start < token.end)) continue;
    const body = match[1] as string;
    let value: string | undefined;
    if (body.startsWith('#x') || body.startsWith('#X'))
      value = String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    else if (body.startsWith('#')) value = String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    else value = ENTITIES[body];
    if (value === undefined) continue;
    const end = start + match[0].length;
    tokens.push({
      start,
      end,
      chars: [...value].flatMap((unit) => [...unit].map((u) => [u, start, end] as [string, number, number])),
    });
  }
  return tokens.length === 0 ? undefined : inPlace(raw, tokens);
}

/** A Java properties file: `\n`, `\\` and `\uXXXX` decoded, and a backslash at the end of a line joins the next. */
function propertiesView(raw: string): View | undefined {
  const tokens: Token[] = [];
  const pattern = /^[ \t]*([^#!\s=:][^=:\n]*?)[ \t]*[=:][ \t]*/gm;
  for (const match of raw.matchAll(pattern)) {
    const from = (match.index as number) + match[0].length;
    const chars: Array<[string, number, number]> = [];
    let i = from;
    while (i < raw.length) {
      const c = raw[i] as string;
      if (c === '\n') break;
      if (c !== '\\') {
        chars.push([c, i, i + 1]);
        i++;
        continue;
      }
      const e = raw[i + 1] ?? '';
      if (e === '\n') {
        let j = i + 2;
        while (raw[j] === ' ' || raw[j] === '\t') j++;
        i = j;
      } else if (e === 'u') {
        const code = Number.parseInt(raw.slice(i + 2, i + 6), 16);
        if (Number.isNaN(code)) break;
        chars.push([String.fromCharCode(code), i, i + 6]);
        i += 6;
      } else {
        chars.push([(CODE_ESCAPES[e] ?? e) as string, i, i + 2]);
        i += 2;
      }
    }
    tokens.push({ start: from, end: i, chars });
  }
  const changed = tokens.some((token) => token.chars.length !== token.end - token.start);
  return changed ? inPlace(raw, tokens) : undefined;
}

/** A CSV file: a quoted cell is read with its doubled quotes as one quote. */
function csvView(raw: string): View | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const atCell = i === 0 || raw[i - 1] === ',' || raw[i - 1] === '\n';
    if (raw[i] !== '"' || !atCell) {
      i++;
      continue;
    }
    const chars: Array<[string, number, number]> = [];
    let j = i + 1;
    while (j < raw.length) {
      if (raw[j] === '"' && raw[j + 1] === '"') {
        chars.push(['"', j, j + 2]);
        j += 2;
      } else if (raw[j] === '"') break;
      else {
        chars.push([raw[j] as string, j, j + 1]);
        j++;
      }
    }
    if (j >= raw.length) break;
    tokens.push({ start: i, end: j + 1, chars });
    i = j + 1;
  }
  return tokens.some(
    (token) =>
      token.chars.length !== token.end - token.start - 2 || token.chars.some(([, a, b]) => b - a !== 1),
  )
    ? inPlace(raw, tokens)
    : undefined;
}

/** reStructuredText: a backslash before a character stands for that character (`\\*` is `*`). */
function rstView(raw: string): View | undefined {
  const tokens: Token[] = [];
  for (const match of raw.matchAll(/\\([^\s])/g)) {
    const start = match.index as number;
    tokens.push({ start, end: start + 2, chars: [[match[1] as string, start, start + 2]] });
  }
  return tokens.length === 0 ? undefined : inPlace(raw, tokens);
}

/** LaTeX: a command with one braced argument (`\\textbf{word}`) reads as its argument. */
function latexView(raw: string): View | undefined {
  const tokens: Token[] = [];
  for (const match of raw.matchAll(/\\[A-Za-z]+\*?\{([^{}]*)\}/g)) {
    const start = match.index as number;
    const end = start + match[0].length;
    const inner = match[1] as string;
    const innerStart = start + match[0].indexOf('{') + 1;
    tokens.push({
      start,
      end,
      chars: [...inner].map((c, i) => [c, innerStart + i, innerStart + i + 1] as [string, number, number]),
    });
  }
  return tokens.length === 0 ? undefined : inPlace(raw, tokens);
}

const VIEWS: Array<[RegExp, (raw: string) => View | undefined]> = [
  [/\.jsonl$/i, jsonLinesView],
  [/\.json$/i, jsonView],
  [/\.ya?ml$/i, yamlView],
];

VIEWS.push(
  [/\.properties$/i, propertiesView],
  [/\.csv$/i, csvView],
  [/\.rst$/i, rstView],
  [/\.tex$/i, latexView],
  [/\.html?$/i, (raw) => markupView(raw, true)],
  [/\.(xml|svg)$/i, (raw) => markupView(raw, /<w:(document|body|p|t)\b/.test(raw))],
);

for (const [pattern, language] of LANGUAGES) VIEWS.push([pattern, (raw) => codeView(raw, language)]);

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
    // The run must also be one passage of the file: each character follows the one before.
    if (plain && run !== '' && start !== (view.ends[i - 1] ?? -2)) flush();
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
