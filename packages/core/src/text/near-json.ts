/**
 * Repairs for near-JSON: model answers that are JSON but for a slip a reader sees at once (unescaped quotes inside a
 * string, single or curly quotes, a comment line, a trailing comma). Each touches only that slip; none adds, removes
 * or renames a key or a value outside a string. Shared by the judges and the estate labelers.
 */

/**
 * Repairs unescaped quotes inside JSON strings. An object value ends before a comma only when the
 * next token is a property name followed by a colon. A quoted word in a prose list cannot end it.
 * Invalid JSON backslash escapes inside a string are retained as literal backslashes.
 * No key, verdict or value outside a string is added, removed or renamed.
 */
export function repairAnswerText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let key = false;
  let previous = '';
  const containers: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (!inString) {
      if (ch === '"') {
        inString = true;
        key = containers.at(-1) === '{' && previous !== ':';
      } else {
        if (ch === '{' || ch === '[') containers.push(ch);
        if (ch === '}' || ch === ']') containers.pop();
        if (!/\s/.test(ch)) previous = ch;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      const valid =
        next !== undefined &&
        (/["\\/bfnrt]/.test(next) || (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2))));
      escaped = valid;
      out += valid ? ch : '\\\\';
      continue;
    }
    if (ch === '"') {
      const rest = text.slice(i + 1).trimStart();
      const next = rest[0];
      const comma = next === ',' && (containers.at(-1) !== '{' || /^,\s*"(?:\\.|[^"\\])*"\s*:/.test(rest));
      if (key ? next === ':' : next === undefined || next === '}' || next === ']' || comma) {
        inString = false;
        previous = '"';
        out += ch;
      } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Near-JSON written with single quotes: a string opened with `'` is rewritten with double quotes. A double quote inside
 * it is escaped and an escaped apostrophe is unescaped. Text outside strings is not touched.
 */
export function singleToDoubleQuotes(text: string): string {
  let out = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote === undefined) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        out += '"';
      } else out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      i += 1;
      if (next === undefined) break;
      out += quote === "'" && next === "'" ? "'" : `\\${next}`;
      continue;
    }
    if (ch === quote) {
      quote = undefined;
      out += '"';
    } else out += quote === "'" && ch === '"' ? '\\"' : ch;
  }
  return out;
}

/**
 * Near-JSON written with typographic double quotes: a string opened by a curly quote ends at the next curly quote, and
 * both become straight quotes. A straight quote inside it is escaped. Strings opened with a straight quote are copied
 * as they are, curly quotes inside them included.
 */
export function straightenCurlyQuotes(text: string): string {
  const curly = (ch: string) => ch === '\u201c' || ch === '\u201d';
  let out = '';
  let mode: 'straight' | 'curly' | undefined;
  let escaped = false;
  for (const ch of text) {
    if (mode === undefined) {
      if (ch === '"') mode = 'straight';
      else if (curly(ch)) mode = 'curly';
      out += ch === '"' || curly(ch) ? '"' : ch;
      continue;
    }
    if (mode === 'straight') {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') mode = undefined;
      out += ch;
      continue;
    }
    if (curly(ch)) {
      mode = undefined;
      out += '"';
    } else out += ch === '"' ? '\\"' : ch;
  }
  return out;
}

/** Near-JSON with a line that holds only a `//` comment: the line is dropped. A string cannot span lines, so no value is touched. */
export function dropCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Near-JSON with one comma before the closing brace: the comma outside strings is dropped. */
export function dropTrailingComma(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}
