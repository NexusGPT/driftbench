import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { EvidencePredicate } from '../schema';
import { sha } from './cut';

/**
 * Label sets are user configuration: a named list of labels the user declares and describes. The core knows
 * sets, labels, windows and answers; it holds no word of any domain. A set that ships with the estate
 * scanner is data loaded the same way as a user's own set.
 */

const LABEL_NAME = /^[a-z][a-z0-9-]*$/;

/** A kind of span a labeler may point at inside one unit: a clause by offsets, never by words. */
export const SpanKind = z.strictObject({
  name: z.string().regex(LABEL_NAME, { error: 'a span kind name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  /** The spans of this kind carry a polarity, obligation or prohibition. */
  polarity: z.literal(true).optional(),
});
export type SpanKind = z.infer<typeof SpanKind>;

/** A kind of link from a unit to an atom the request listed as a candidate. */
export const LinkKind = z.strictObject({
  name: z.string().regex(LABEL_NAME, { error: 'a link kind name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  /** The kinds of atom a link of this kind may name. */
  to: z.array(z.string().min(1)).min(1),
});
export type LinkKind = z.infer<typeof LinkKind>;

export const Label = z.strictObject({
  name: z
    .string()
    .regex(LABEL_NAME, {
      error: 'a label name is lower case letters, digits and hyphens, starting with a letter',
    })
    .refine((name) => name !== 'none', { error: 'none is reserved: every set allows it' }),
  description: z.string().min(1),
  examples: z.array(z.string().min(1)).max(3).optional(),
  target: z.literal('required').optional(),
  /** A unit with this label states when its target unit applies: it becomes the situation of the target's atom. */
  condition: z.literal(true).optional(),
  /** The span kinds a unit with this label may carry. */
  spans: z.array(z.string().min(1)).min(1).optional(),
  /** The link kinds a unit with this label may carry. */
  links: z.array(z.string().min(1)).min(1).optional(),
  atom: z
    .strictObject({
      kind: z.string().min(1),
      polarity: z.enum(['obligation', 'prohibition']).optional(),
      /** What the atom is about, in words: the set's own text, used when no condition unit gives one. */
      situation: z.string().min(1).optional(),
      /** Fields the set puts on every atom of this label, such as the id of a hazard. */
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      /** Checks the set puts on every atom of this label, after the review check the scan adds. */
      evidence: z.array(EvidencePredicate).optional(),
    })
    .optional(),
});
export type Label = z.infer<typeof Label>;

export const LabelSet = z.strictObject({
  set: z.string().regex(LABEL_NAME, { error: 'a set name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  spans: z.array(SpanKind).min(1).optional(),
  links: z.array(LinkKind).min(1).optional(),
  labels: z.array(Label).min(1),
});
export type LabelSet = z.infer<typeof LabelSet>;

const LabelFile = z.strictObject({ labels: z.array(LabelSet).min(1) });

/** Sorted-key JSON: the same value always gives the same bytes. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

export type LabelSetsResult = { ok: true; sets: LabelSet[] } | { ok: false; message: string };

/** Reads the `labels:` list of a YAML text, and refuses a duplicate set or label name. */
export function parseLabelSets(text: string): LabelSetsResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = LabelFile.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.map(String).join('.') ?? '';
    return { ok: false, message: `${path ? `${path}: ` : ''}${first?.message ?? 'unknown problem'}` };
  }
  const seen = new Set<string>();
  for (const set of parsed.data.labels) {
    if (seen.has(set.set)) return { ok: false, message: `the set ${set.set} is declared twice` };
    seen.add(set.set);
    const spanKinds = new Set<string>();
    for (const kind of set.spans ?? []) {
      if (spanKinds.has(kind.name))
        return { ok: false, message: `the set ${set.set} declares the span kind ${kind.name} twice` };
      spanKinds.add(kind.name);
    }
    const linkKinds = new Set<string>();
    for (const kind of set.links ?? []) {
      if (linkKinds.has(kind.name))
        return { ok: false, message: `the set ${set.set} declares the link kind ${kind.name} twice` };
      linkKinds.add(kind.name);
    }
    const names = new Set<string>();
    for (const label of set.labels) {
      for (const kind of label.spans ?? []) {
        if (!spanKinds.has(kind)) {
          return {
            ok: false,
            message: `the label ${label.name} names the span kind ${kind}, which the set does not declare`,
          };
        }
      }
      for (const kind of label.links ?? []) {
        if (!linkKinds.has(kind)) {
          return {
            ok: false,
            message: `the label ${label.name} names the link kind ${kind}, which the set does not declare`,
          };
        }
      }
      if (names.has(label.name))
        return { ok: false, message: `the set ${set.set} declares ${label.name} twice` };
      names.add(label.name);
      if (label.condition && label.target !== 'required') {
        return { ok: false, message: `the label ${label.name} is a condition and needs target: required` };
      }
      if (label.condition && label.atom) {
        return {
          ok: false,
          message: `the label ${label.name} is a condition and builds no atom of its own: it takes no atom mapping`,
        };
      }
    }
  }
  return { ok: true, sets: parsed.data.labels };
}

/** The hash of a set's canonical form: editing one label changes only that set's hash. */
export const setHash = (set: LabelSet): string => sha(canonical(set)).slice(0, 16);

/** One unit as the labeler sees it: a number valid in this window only. */
export type WindowUnit = { n: number; text: string; index: number };

/** A run of units, cut at headings, that one request labels. `index` is the unit's place in its file. */
export type Window = { id: string; path: string; headingPath: string[]; units: WindowUnit[] };

/** What a labeler says about a window: a label per unit or range, and a target for a label that needs one. */
export type Labelled = {
  units: string;
  label: string;
  target?: number;
  spans?: SpanAnswer[];
  links?: LinkAnswer[];
};

/** A span as answered: offsets into the text of one unit, `to` exclusive. */
export type SpanAnswer = { kind: string; from: number; to: number; polarity?: string };

/** A link as answered: a kind and the id of a candidate atom (or `none`). */
export type LinkAnswer = { kind: string; to: string };

/** What a request lists for a labeler to point at: the atoms of the kinds a link may name. */
export type LabelContext = {
  candidates?: Readonly<Record<string, ReadonlyArray<{ id: string; label: string }>>>;
};

/** `5` or `5-7` as the numbers it names. */
export function expandUnits(units: string): number[] | undefined {
  const match = /^(\d+)(?:-(\d+))?$/.exec(units.trim());
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  if (to < from || to - from > 10_000) return undefined;
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

export type Checked = {
  /** Unit number to its label, for a label other than none. */
  accepted: Map<number, { label: string; target?: number; spans?: SpanAnswer[]; links?: LinkAnswer[] }>;
  /** Unit numbers the answer named (none included). */
  covered: Set<number>;
  refusals: string[];
};

/**
 * Checks an answer against its window and set. Refused, with the reason: a label not in the set, a unit not in
 * the window, a unit named twice, a target on a label that takes none (or missing on one that needs it).
 */
export function checkAnswer(
  set: LabelSet,
  window: Window,
  answer: readonly Labelled[],
  context: LabelContext = {},
): Checked {
  const allowed = new Map(set.labels.map((label) => [label.name, label]));
  const inWindow = new Set(window.units.map((unit) => unit.n));
  const accepted: Checked['accepted'] = new Map();
  const covered = new Set<number>();
  const refusals: string[] = [];
  for (const entry of answer) {
    const label = allowed.get(entry.label);
    if (entry.label !== 'none' && !label) {
      refusals.push(`${window.id}: the label ${entry.label} is not in the set ${set.set}`);
      continue;
    }
    const numbers = expandUnits(entry.units);
    if (!numbers) {
      refusals.push(`${window.id}: "${entry.units}" is no unit number or range`);
      continue;
    }
    if (numbers.some((n) => !inWindow.has(n))) {
      refusals.push(`${window.id}: "${entry.units}" leaves the window`);
      continue;
    }
    if (numbers.some((n) => covered.has(n))) {
      refusals.push(`${window.id}: "${entry.units}" names a unit that is already labelled`);
      continue;
    }
    if (entry.target !== undefined && (typeof entry.target !== 'number' || !Number.isInteger(entry.target))) {
      refusals.push(`${window.id}: the target ${JSON.stringify(entry.target)} is no unit number`);
      continue;
    }
    if (entry.label === 'none' && entry.target !== undefined) {
      refusals.push(`${window.id}: the label none takes no target`);
      continue;
    }
    if (label?.target === 'required' && (entry.target === undefined || !inWindow.has(entry.target))) {
      refusals.push(`${window.id}: the label ${entry.label} needs a target unit inside the window`);
      continue;
    }
    if (label && label.target !== 'required' && entry.target !== undefined) {
      refusals.push(`${window.id}: the label ${entry.label} takes no target`);
      continue;
    }
    const extras = checkExtras(set, window, entry, numbers, label, context);
    if (typeof extras === 'string') {
      refusals.push(`${window.id}: ${extras}`);
      continue;
    }
    for (const n of numbers) {
      covered.add(n);
      if (entry.label !== 'none') {
        accepted.set(n, {
          label: entry.label,
          ...(entry.target !== undefined ? { target: entry.target } : {}),
          ...extras,
        });
      }
    }
  }
  return { accepted, covered, refusals };
}

const POLARITIES = new Set(['obligation', 'prohibition']);

/**
 * The spans and links of one entry, checked. A span is offsets into the text of one unit: integers, from under
 * to, inside the unit, of a kind the label may carry, with a polarity only where the kind has one, and never
 * overlapping another span of the unit. A link names a kind the label may carry and a candidate the request
 * listed (or `none`). Any failure refuses the whole entry: the reason is returned as a string.
 */
function checkExtras(
  set: LabelSet,
  window: Window,
  entry: Labelled,
  numbers: readonly number[],
  label: Label | undefined,
  context: LabelContext,
): string | { spans?: SpanAnswer[]; links?: LinkAnswer[] } {
  const out: { spans?: SpanAnswer[]; links?: LinkAnswer[] } = {};
  if (entry.spans !== undefined) {
    if (!Array.isArray(entry.spans) || entry.spans.length === 0) return 'spans are a non-empty list';
    if (numbers.length !== 1) return `"${entry.units}" is a range, and a range cannot carry spans`;
    if (!label?.spans) return `the label ${entry.label} carries no spans`;
    const unit = window.units.find((candidate) => candidate.n === numbers[0]);
    if (!unit) return `"${entry.units}" leaves the window`;
    const kinds = new Map((set.spans ?? []).map((kind) => [kind.name, kind]));
    const seen: SpanAnswer[] = [];
    for (const span of entry.spans) {
      const where = `unit [${unit.n}] span ${JSON.stringify(span)}`;
      if (span === null || typeof span !== 'object') return `${where} is no span`;
      const kind = typeof span.kind === 'string' ? kinds.get(span.kind) : undefined;
      if (!kind || !label.spans.includes(kind.name)) {
        return `${where}: the kind ${JSON.stringify(span.kind)} is not one the label ${entry.label} may carry`;
      }
      if (!Number.isInteger(span.from) || !Number.isInteger(span.to)) return `${where}: offsets are integers`;
      if (span.from < 0 || span.to > unit.text.length || span.from >= span.to) {
        return `${where}: offsets leave the unit (length ${unit.text.length}) or are empty`;
      }
      if (span.polarity !== undefined) {
        if (!kind.polarity) return `${where}: the kind ${kind.name} carries no polarity`;
        if (typeof span.polarity !== 'string' || !POLARITIES.has(span.polarity)) {
          return `${where}: the polarity is obligation or prohibition`;
        }
      }
      if (seen.some((other) => span.from < other.to && other.from < span.to)) {
        return `${where} overlaps another span of the unit`;
      }
      seen.push({
        kind: span.kind,
        from: span.from,
        to: span.to,
        ...(span.polarity !== undefined ? { polarity: span.polarity } : {}),
      });
    }
    out.spans = seen.sort((a, b) => a.from - b.from);
  }
  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links) || entry.links.length === 0) return 'links are a non-empty list';
    if (!label?.links) return `the label ${entry.label} carries no links`;
    const kinds = new Map((set.links ?? []).map((kind) => [kind.name, kind]));
    const links: LinkAnswer[] = [];
    for (const link of entry.links) {
      const where = `units "${entry.units}" link ${JSON.stringify(link)}`;
      if (link === null || typeof link !== 'object') return `${where} is no link`;
      const kind = typeof link.kind === 'string' ? kinds.get(link.kind) : undefined;
      if (!kind || !label.links.includes(kind.name)) {
        return `${where}: the kind ${JSON.stringify(link.kind)} is not one the label ${entry.label} may carry`;
      }
      if (typeof link.to !== 'string') return `${where}: the target is an atom id or none`;
      if (links.some((other) => other.kind === kind.name))
        return `${where}: the kind ${kind.name} is given twice`;
      if (link.to !== 'none') {
        const listed = context.candidates?.[kind.name] ?? [];
        if (!listed.some((candidate) => candidate.id === link.to)) {
          return `${where}: ${link.to} is not an atom the request listed for ${kind.name}`;
        }
      }
      links.push({ kind: kind.name, to: link.to });
    }
    out.links = links;
  }
  return out;
}
