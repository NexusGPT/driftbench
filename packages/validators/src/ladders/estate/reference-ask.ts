import templates from './ask-templates.json';

/**
 * The validator's own reading of an ask that code wrote (docs/estate.md section 5, "The ask templates"), kept
 * apart from the product: `gen.asks` must never judge `codeAsk` with `codeAsk`, since a product that changes every
 * code-written ask would then be its own witness. An ask passes only when it equals one `ask` template of
 * `ask-templates.json`, with each slot filled from the atoms of the row: an `act` is one of the `act` templates,
 * a `situation` one of the `situation` templates, and a `span` is a run of whole words that stands in the text of
 * an atom, compared after markup, case and trailing punctuation are set aside. No stem, no synonym, no word list.
 * A test fails when the file differs from the table of the document.
 */

type Part = { lit: string } | { slot: string } | { opt: Part[] };
type Entry = { kind: string; template: string };

export const ASK_TEMPLATES: readonly Entry[] = templates;

/** A template as literals, slots and optional groups (`[...]`). */
function parse(template: string): Part[] {
  const stack: Part[][] = [[]];
  let lit = '';
  const flush = () => {
    if (lit !== '') (stack.at(-1) as Part[]).push({ lit });
    lit = '';
  };
  for (let i = 0; i < template.length; i++) {
    const c = template[i] as string;
    if (c === '{') {
      flush();
      const end = template.indexOf('}', i);
      (stack.at(-1) as Part[]).push({ slot: template.slice(i + 1, end) });
      i = end;
    } else if (c === '[') {
      flush();
      stack.push([]);
    } else if (c === ']') {
      flush();
      const opt = stack.pop() as Part[];
      (stack.at(-1) as Part[]).push({ opt });
    } else lit += c;
  }
  flush();
  return stack[0] as Part[];
}

const parsed = (kind: string): Part[][] =>
  ASK_TEMPLATES.filter((entry) => entry.kind === kind).map((entry) => parse(entry.template));
const ASKS = parsed('ask');
const ACTS = parsed('act');
const SITUATIONS = parsed('situation');
const FIXED = new Set(ASK_TEMPLATES.filter((entry) => entry.kind === 'fixed').map((entry) => entry.template));

/** Text with markup, case, extra space and final punctuation set aside. */
export function normal(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;,!?]+$/, '')
    .toLowerCase();
}

/** The strings of the atoms of a row: their title, situation and every string field, normalised. */
export function atomTexts(
  atoms: readonly { title?: string; situation?: string; fields?: unknown }[],
): string[] {
  const out: string[] = [];
  const add = (value: unknown, depth = 0): void => {
    if (typeof value === 'string') out.push(normal(value));
    else if (Array.isArray(value) && depth < 3) for (const item of value) add(item, depth + 1);
    else if (value !== null && typeof value === 'object' && depth < 3)
      for (const item of Object.values(value)) add(item, depth + 1);
  };
  for (const atom of atoms) {
    add(atom.title);
    add(atom.situation);
    add(atom.fields);
  }
  return out;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Whether `value` stands in a text as whole words. */
function stands(value: string, text: string): boolean {
  const first = value[0];
  const last = value[value.length - 1];
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
    const before = text[at - 1];
    const after = text[at + value.length];
    if ((!isWordChar(first) || !isWordChar(before)) && (!isWordChar(last) || !isWordChar(after))) return true;
  }
  return false;
}

/** Matches `text` from `at` against parts, trying every fill of every slot; `accept` judges one slot value. */
function matches(
  parts: readonly Part[],
  text: string,
  accept: (slot: string, value: string) => boolean,
  at = 0,
  rest: (pos: number) => boolean = (pos) => pos === text.length,
): boolean {
  const step = (index: number, pos: number, k: (pos: number) => boolean): boolean => {
    const part = parts[index];
    if (part === undefined) return k(pos);
    if ('lit' in part) return text.startsWith(part.lit, pos) && step(index + 1, pos + part.lit.length, k);
    if ('opt' in part)
      return (
        matches(part.opt, text, accept, pos, (next) => step(index + 1, next, k)) || step(index + 1, pos, k)
      );
    for (let end = pos + 1; end <= text.length; end++)
      if (accept(part.slot, text.slice(pos, end)) && step(index + 1, end, k)) return true;
    return false;
  };
  return step(0, at, rest);
}

/** Whether `ask` is a code-written ask of the document, filled from `texts` (the strings of the row's atoms). */
export function readsAsCodeAsk(ask: string, texts: readonly string[]): boolean {
  if (FIXED.has(ask)) return true;
  const seen = new Map<string, boolean>();
  const memo = (key: string, judge: () => boolean): boolean => {
    const known = seen.get(key);
    if (known !== undefined) return known;
    const verdict = judge();
    seen.set(key, verdict);
    return verdict;
  };
  const span = (value: string): boolean =>
    memo(`span:${value}`, () => {
      const wanted = normal(value);
      return wanted !== '' && texts.some((text) => stands(wanted, text));
    });
  // A bare `{span}` act or situation is a task or a sentence: at least `bare` words.
  const filled = (templatesOf: Part[][], value: string, bare: number): boolean =>
    templatesOf.some((parts) => {
      const only = parts.length === 1 && 'slot' in (parts[0] as Part);
      return matches(parts, value, (slot, inner) => {
        if (slot !== 'span') return false;
        if (only && normal(inner).split(' ').length < bare) return false;
        return span(inner);
      });
    });
  const accept = (slot: string, value: string): boolean => {
    if (slot === 'act') return memo(`act:${value}`, () => filled(ACTS, value, 3));
    if (slot === 'situation') return memo(`situation:${value}`, () => filled(SITUATIONS, value, 1));
    return slot === 'span' && span(value);
  };
  return ASKS.some((parts) => matches(parts, ask, accept));
}
