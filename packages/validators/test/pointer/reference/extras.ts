import { bugsC } from './bugs-c';
import type { ParsedSet, RefLabel, SpanKindDef } from './labelset';
import type { Candidates, PlanUnit } from './window';

/**
 * The parts of an answer beyond a label per unit (design section 3, "Validation of an answer", and the span
 * and link kinds of a set): the one JSON object of an answer text, and the spans and links of an entry. A refusal
 * has the reader's own words and a `why`: the stable code of the cause and the names it is about, which an item
 * reads (never the words).
 */

/** The structured cause of a refused answer: a stable code, and the identifiers the words name. */
export type Why = {
  reason: string;
  units?: string;
  label?: string;
  kind?: string;
  span?: string;
  parent?: string;
  target?: string;
  /** The number of the unit inside its window, for a span. */
  unit?: string;
};

/** A refusal: the words and the cause. */
export type Problem = { reason: string; why: Why };

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
): { from: number; to: number } | { reason: string; code: string } {
  const lower = unitText.toLowerCase();
  const wanted = words.toLowerCase();
  const guard = !bugsC.has('case-fold-no-length-guard') && lower.length !== unitText.length;
  const first = wanted === '' || guard ? -1 : lower.indexOf(wanted);
  if (first < 0) return { reason: 'the text is not in the unit', code: 'span-text-absent' };
  if (!bugsC.has('span-text-twice-accepted') && lower.indexOf(wanted, first + 1) >= 0)
    return { reason: 'the text is found twice in the unit', code: 'span-text-repeated' };
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
 * The spans and links of one entry, checked; the first failure, or undefined. A span is the words of a clause, or
 * offsets into the text the labeler was shown: inside the unit, of a kind the label may carry, with a polarity
 * only where the kind has one, never overlapping another span of the unit unless one kind is within the other,
 * and a span of a nested kind inside a span of its parent kind. A link names a kind the label may carry, once,
 * and a candidate the request listed (`candidates`) or `none`.
 */
export function extrasProblem(
  set: ParsedSet,
  entry: Entry,
  numbers: readonly number[],
  label: RefLabel | undefined,
  units: readonly PlanUnit[],
  candidates: Candidates = {},
): Problem | undefined {
  const name = String(entry.label);
  const written = String(entry.units);
  const own = { units: written, label: name };
  if (entry.spans !== undefined) {
    if (!Array.isArray(entry.spans) || entry.spans.length === 0)
      return { reason: 'spans are a non-empty list', why: { reason: 'spans-malformed', ...own } };
    if (numbers.length !== 1)
      return {
        reason: `"${written}" is a range, and a range cannot carry spans`,
        why: { reason: 'span-range-unit', ...own },
      };
    if (!label?.spans)
      return {
        reason: `the label ${name} carries no spans`,
        why: { reason: 'label-carries-no-spans', ...own },
      };
    const unit = units[(numbers[0] as number) - 1];
    if (!unit)
      return { reason: `"${written}" leaves the window`, why: { reason: 'span-unit-leaves-window', ...own } };
    const here = { unit: String(unit.n), label: name };
    const kinds = new Map((set.spans ?? []).map((kind) => [kind.name, kind]));
    const counted: Array<{ kind: string; from: number; to: number; shown: string }> = [];
    const shown = flatten(unit.text);
    for (const span of entry.spans as unknown[]) {
      const where = `unit [${unit.n}] span ${JSON.stringify(span)}`;
      if (!isObject(span))
        return { reason: `${where} is no span`, why: { reason: 'span-malformed', ...here } };
      const kind = typeof span.kind === 'string' ? kinds.get(span.kind) : undefined;
      if (!kind || !label.spans.includes(kind.name))
        return {
          reason: `${where}: the kind ${JSON.stringify(span.kind)} is not one the label ${name} may carry`,
          why: {
            reason: 'span-kind-not-allowed',
            ...here,
            ...(typeof span.kind === 'string' ? { kind: span.kind } : {}),
          },
        };
      const spanned = { ...here, kind: kind.name };
      let from: number;
      let to: number;
      let words: string | undefined;
      if (typeof span.text === 'string') {
        const found = locateSpanText(shown.text, span.text);
        if ('reason' in found)
          return {
            reason: `${where}: ${found.reason}`,
            why: { reason: found.code, ...spanned, span: span.text },
          };
        ({ from, to } = found);
        words = span.text;
      } else if (Number.isInteger(span.from) && Number.isInteger(span.to)) {
        from = span.from as number;
        to = span.to as number;
        if (from < 0 || to > shown.text.length || from >= to)
          return {
            reason: `${where}: offsets leave the unit (length ${shown.text.length}) or are empty`,
            why: { reason: 'span-offsets-invalid', ...spanned, span: `${from}-${to}` },
          };
      } else {
        return {
          reason: `${where}: offsets are integers, or the text is a string`,
          why: { reason: 'span-shape-invalid', ...spanned },
        };
      }
      if (span.polarity !== undefined && span.polarity !== null) {
        if (!kind.polarity)
          return {
            reason: `${where}: the kind ${kind.name} carries no polarity`,
            why: { reason: 'span-polarity-not-allowed', ...spanned },
          };
        if (typeof span.polarity !== 'string' || !POLARITIES.has(span.polarity))
          return {
            reason: `${where}: the polarity is obligation or prohibition`,
            why: { reason: 'span-polarity-invalid', ...spanned },
          };
      }
      const touching = bugsC.has('adjacent-spans-overlap');
      const overlaps = counted.some(
        (other) =>
          (touching ? from <= other.to : from < other.to) &&
          other.from < to &&
          !(ancestor(kinds, kind.name, other.kind) || ancestor(kinds, other.kind, kind.name)),
      );
      const text = words ?? `${from}-${to}`;
      if (overlaps)
        return {
          reason: `${where} overlaps another span of the unit`,
          why: { reason: 'span-overlap', ...spanned, span: text },
        };
      counted.push({ kind: kind.name, from, to, shown: text });
    }
    for (const inner of counted) {
      const outer = kinds.get(inner.kind)?.within;
      const inside = (other: { kind: string; from: number; to: number }) =>
        other.kind === outer &&
        other.from <= inner.from &&
        (bugsC.has('nested-span-overrun') ? inner.from < other.to : inner.to <= other.to);
      if (outer !== undefined && !counted.some(inside)) {
        const where = `unit [${unit.n}] has a span of the kind ${inner.kind}`;
        return {
          reason: `${where} that is not inside a span of the kind ${outer}`,
          why: { reason: 'span-outside-parent', ...here, kind: inner.kind, parent: outer, span: inner.shown },
        };
      }
    }
  }
  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links) || entry.links.length === 0)
      return { reason: 'links are a non-empty list', why: { reason: 'links-malformed', ...own } };
    if (!label?.links)
      return {
        reason: `the label ${name} carries no links`,
        why: { reason: 'label-carries-no-links', ...own },
      };
    const kinds = new Map((set.links ?? []).map((kind) => [kind.name, kind]));
    const given: string[] = [];
    for (const link of entry.links as unknown[]) {
      const where = `units "${written}" link ${JSON.stringify(link)}`;
      if (!isObject(link))
        return { reason: `${where} is no link`, why: { reason: 'link-malformed', ...own } };
      const kind = typeof link.kind === 'string' ? kinds.get(link.kind) : undefined;
      if (!kind || !label.links.includes(kind.name))
        return {
          reason: `${where}: the kind ${JSON.stringify(link.kind)} is not one the label ${name} may carry`,
          why: {
            reason: 'link-kind-not-allowed',
            ...own,
            ...(typeof link.kind === 'string' ? { kind: link.kind } : {}),
          },
        };
      if (typeof link.to !== 'string')
        return {
          reason: `${where}: the target is an atom id or none`,
          why: { reason: 'link-target-malformed', ...own, kind: kind.name },
        };
      if (!bugsC.has('link-kind-twice') && given.includes(kind.name))
        return {
          reason: `${where}: the kind ${kind.name} is given twice`,
          why: { reason: 'link-kind-repeated', ...own, kind: kind.name, target: link.to },
        };
      // The candidates the request listed for the kind: its closed values, or the atoms of the kinds it names
      // (scan.ts); with no listing given, the values of the kind and no atom.
      const listed =
        candidates[kind.name]?.map((candidate) => candidate.shown ?? candidate.id) ?? kind.values ?? [];
      if (link.to !== 'none' && !bugsC.has('link-unlisted') && !listed.includes(link.to))
        return {
          reason: `${where}: ${link.to} is not an atom the request listed for ${kind.name}`,
          why: { reason: 'link-target-unlisted', ...own, kind: kind.name, target: link.to },
        };
      given.push(kind.name);
    }
  }
  return undefined;
}
