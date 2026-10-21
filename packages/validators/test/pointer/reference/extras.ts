import { bugsC } from './bugs-c';
import type { ParsedSet, RefLabel, SpanKindDef } from './labelset';
import type { PlanUnit } from './window';

/**
 * The parts of an answer beyond a label per unit (design section 3, "Validation of an answer", and the span
 * and link kinds of a set): the one JSON object of an answer text, and the spans and links of an entry. The
 * reasons are the reader's own words, so an item can name them.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The one JSON object of a text that holds a `labels` list: the text itself, the inside of its only code
 * fence, or the span from its first `{` to its last `}`. A text with two objects or two fences has none.
 */
export function jsonObjectOf(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/```[A-Za-z]*\s*\n([\s\S]*?)\n?```/g)];
  const only = bugsC.has('two-fences-first-wins') ? fences.length >= 1 : fences.length === 1;
  const candidates = [trimmed, only ? fences[0]?.[1]?.trim() : undefined];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (isObject(value) && Array.isArray(value.labels)) return value;
    } catch {
      // The next candidate.
    }
  }
  return undefined;
}

/**
 * Runs of white space made one space, the ends trimmed; `at[i]` is the offset in the unit of shown character
 * i.
 */
export function flatten(text: string): { text: string; at: number[] } {
  let shown = '';
  const at: number[] = [];
  let pending = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (/\s/.test(char)) {
      if (shown !== '' && pending < 0) pending = index;
      continue;
    }
    if (pending >= 0) {
      shown += ' ';
      at.push(pending);
      pending = -1;
    }
    shown += char;
    at.push(index);
  }
  return { text: shown, at };
}

/**
 * Where the words of a clause sit in the text of a unit: found without regard to case, exactly once. A unit
 * whose lower case has another length than the unit (a letter that folds to two) holds no text: its offsets
 * would not be the unit's.
 */
export function locateSpanText(
  unitText: string,
  words: string,
): { from: number; to: number } | { reason: string } {
  const lower = unitText.toLowerCase();
  const wanted = words.toLowerCase();
  const guard = !bugsC.has('case-fold-no-length-guard') && lower.length !== unitText.length;
  const first = wanted === '' || guard ? -1 : lower.indexOf(wanted);
  if (first < 0) return { reason: 'the text is not in the unit' };
  if (!bugsC.has('span-text-twice-accepted') && lower.indexOf(wanted, first + 1) >= 0)
    return { reason: 'the text is found twice in the unit' };
  return { from: first, to: first + wanted.length };
}

/** True when `outer` is the parent of `kind`, or its parent's parent, and so on up the chain. */
function ancestor(kinds: ReadonlyMap<string, SpanKindDef>, kind: string, outer: string): boolean {
  let up = kinds.get(kind)?.within;
  for (let step = 0; up !== undefined && step < kinds.size; step += 1) {
    if (up === outer) return true;
    up = kinds.get(up)?.within;
  }
  return false;
}

const POLARITIES = new Set(['obligation', 'prohibition']);

type Entry = { units?: unknown; label?: unknown; spans?: unknown; links?: unknown };

/**
 * The spans and links of one entry, checked; the reason of the first failure, or undefined. A span is the
 * words of a clause, or offsets into the text the labeler was shown: inside the unit, of a kind the label may
 * carry, with a polarity only where the kind has one, never overlapping another span of the unit unless one
 * kind is within the other, and a span of a nested kind inside a span of its parent kind. A link names a kind
 * the label may carry, once, and a candidate the request listed (the values of the kind) or `none`.
 */
export function extrasProblem(
  set: ParsedSet,
  entry: Entry,
  numbers: readonly number[],
  label: RefLabel | undefined,
  units: readonly PlanUnit[],
): string | undefined {
  const name = String(entry.label);
  if (entry.spans !== undefined) {
    if (!Array.isArray(entry.spans) || entry.spans.length === 0) return 'spans are a non-empty list';
    if (numbers.length !== 1) return `"${String(entry.units)}" is a range, and a range cannot carry spans`;
    if (!label?.spans) return `the label ${name} carries no spans`;
    const unit = units[(numbers[0] as number) - 1];
    if (!unit) return `"${String(entry.units)}" leaves the window`;
    const kinds = new Map((set.spans ?? []).map((kind) => [kind.name, kind]));
    const counted: Array<{ kind: string; from: number; to: number }> = [];
    const shown = flatten(unit.text);
    for (const span of entry.spans as unknown[]) {
      const where = `unit [${unit.n}] span ${JSON.stringify(span)}`;
      if (!isObject(span)) return `${where} is no span`;
      const kind = typeof span.kind === 'string' ? kinds.get(span.kind) : undefined;
      if (!kind || !label.spans.includes(kind.name))
        return `${where}: the kind ${JSON.stringify(span.kind)} is not one the label ${name} may carry`;
      let from: number;
      let to: number;
      if (typeof span.text === 'string') {
        const found = locateSpanText(shown.text, span.text);
        if ('reason' in found) return `${where}: ${found.reason}`;
        ({ from, to } = found);
      } else if (Number.isInteger(span.from) && Number.isInteger(span.to)) {
        from = span.from as number;
        to = span.to as number;
        if (from < 0 || to > shown.text.length || from >= to)
          return `${where}: offsets leave the unit (length ${shown.text.length}) or are empty`;
      } else {
        return `${where}: offsets are integers, or the text is a string`;
      }
      if (span.polarity !== undefined && span.polarity !== null) {
        if (!kind.polarity) return `${where}: the kind ${kind.name} carries no polarity`;
        if (typeof span.polarity !== 'string' || !POLARITIES.has(span.polarity))
          return `${where}: the polarity is obligation or prohibition`;
      }
      const touching = bugsC.has('adjacent-spans-overlap');
      const overlaps = counted.some(
        (other) =>
          (touching ? from <= other.to : from < other.to) &&
          other.from < to &&
          !(ancestor(kinds, kind.name, other.kind) || ancestor(kinds, other.kind, kind.name)),
      );
      if (overlaps) return `${where} overlaps another span of the unit`;
      counted.push({ kind: kind.name, from, to });
    }
    for (const inner of counted) {
      const outer = kinds.get(inner.kind)?.within;
      const inside = (other: { kind: string; from: number; to: number }) =>
        other.kind === outer &&
        other.from <= inner.from &&
        (bugsC.has('nested-span-overrun') ? inner.from < other.to : inner.to <= other.to);
      if (outer !== undefined && !counted.some(inside)) {
        const where = `unit [${unit.n}] has a span of the kind ${inner.kind}`;
        return `${where} that is not inside a span of the kind ${outer}`;
      }
    }
  }
  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links) || entry.links.length === 0) return 'links are a non-empty list';
    if (!label?.links) return `the label ${name} carries no links`;
    const kinds = new Map((set.links ?? []).map((kind) => [kind.name, kind]));
    const given: string[] = [];
    for (const link of entry.links as unknown[]) {
      const where = `units "${String(entry.units)}" link ${JSON.stringify(link)}`;
      if (!isObject(link)) return `${where} is no link`;
      const kind = typeof link.kind === 'string' ? kinds.get(link.kind) : undefined;
      if (!kind || !label.links.includes(kind.name))
        return `${where}: the kind ${JSON.stringify(link.kind)} is not one the label ${name} may carry`;
      if (typeof link.to !== 'string') return `${where}: the target is an atom id or none`;
      if (!bugsC.has('link-kind-twice') && given.includes(kind.name))
        return `${where}: the kind ${kind.name} is given twice`;
      // The candidates of a kind of closed values are its values; a kind of atoms lists none here: the scan
      // of the bank passes no atoms.
      const listed = kind.values ?? [];
      if (link.to !== 'none' && !bugsC.has('link-unlisted') && !listed.includes(link.to))
        return `${where}: ${link.to} is not an atom the request listed for ${kind.name}`;
      given.push(kind.name);
    }
  }
  return undefined;
}
