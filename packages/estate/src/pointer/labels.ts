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
/** A set name is data, not an identifier: it is stored as a key and sent in a request, so it holds no punctuation. */
const SET_NAME = /^[\p{L}\p{N}_-]+$/u;

/** A kind of span a labeler may point at inside one unit: a clause by offsets, never by words. */
export const SpanKind = z.strictObject({
  name: z.string().regex(LABEL_NAME, { error: 'a span kind name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  /** The spans of this kind carry a polarity, obligation or prohibition. */
  polarity: z.literal(true).optional(),
  /** A span of this kind lies inside a span of the named kind, given in the same answer entry. */
  within: z.string().regex(LABEL_NAME, { error: 'within names a span kind' }).optional(),
});
export type SpanKind = z.infer<typeof SpanKind>;

/** A kind of link from a unit to an atom the request listed as a candidate. */
export const LinkKind = z
  .strictObject({
    name: z
      .string()
      .regex(LABEL_NAME, { error: 'a link kind name is lower case letters, digits and hyphens' }),
    description: z.string().min(1),
    /** The kinds of atom a link of this kind may name. */
    to: z.array(z.string().min(1)).min(1).optional(),
    /** Or a closed list of values the set declares, such as the names of a runtime's tools. */
    values: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((kind) => (kind.to === undefined) !== (kind.values === undefined), {
    error: 'a link kind names `to` (atom kinds) or `values` (a closed list), one of the two',
  });
export type LinkKind = z.infer<typeof LinkKind>;

type FieldValue = string | number | boolean | FieldValue[] | { [key: string]: FieldValue };
const FieldValue: z.ZodType<FieldValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(FieldValue), z.record(z.string(), FieldValue)]),
);

const AtomBase = z.strictObject({
  kind: z.string().min(1),
  polarity: z.enum(['obligation', 'prohibition']).optional(),
  /** The title of the atom, in words of the unit: a placeholder or a string. Default: the unit text. */
  title: z.string().min(1).optional(),
  /** What the atom is about, in words: the set's own text, used when no condition unit gives one. */
  situation: z.string().min(1).optional(),
  /**
   * Fields the set puts on every atom of this label, such as the id of a hazard. A value is a scalar, or a list or
   * an object of values: a string anywhere inside it may hold a placeholder, filled from the spans, the links and
   * the unit as for the title, and a value with an unfilled placeholder refuses the atom with its reason.
   */
  fields: z.record(z.string(), FieldValue).optional(),
  /** The reply act the atom governs: a top-level key of the atom, filled as `fields` is, with the same optional keys. */
  replyAct: z.record(z.string(), FieldValue).optional(),
  /** Checks the set puts on every atom of this label, after the review check the scan adds. */
  evidence: z
    .array(
      z.union([
        EvidencePredicate,
        // Left out of the atom when a placeholder inside it does not fill, where any other item that does not fill
        // refuses the atom.
        z.strictObject({ optional: EvidencePredicate }),
      ]),
    )
    .optional(),
  /** Resolve the first path the unit names as a file of the estate: the atom gets its path and whether it exists. `each`: one atom per path the unit names. */
  locate: z.union([z.literal(true), z.literal('each')]).optional(),
  /**
   * One atom for each span of this kind, in the order the label lists them. The label also lists, in the same order,
   * the span of the file of each gate (`spanFile`): the nth span of one kind goes with the nth span of the other (each kind in the order the spans stand), and
   * nothing is bound by where a span or a path stands in the unit. A gate with no file span is refused.
   */
  spanEach: z.string().min(1).optional(),
  spanFile: z.string().min(1).optional(),
  /** Build this atom only when the first code span of the unit leads to a file of the estate. */
  whenFile: z.union([z.literal(true), z.literal('each')]).optional(),
});

/** What a label builds: one atom, and the further atoms the same unit also is (a gate that also names a file). */
export const AtomMapping = AtomBase.extend({ also: z.array(AtomBase).min(1).optional() });
export type AtomMapping = z.infer<typeof AtomMapping>;

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
  /**
   * A unit with this label builds no atom of its own: the `fields` of its mapping are filled from its spans and links
   * and added to the atoms that labels of other sets built for the same unit (a key the atom already holds stays).
   */
  annotate: z.literal(true).optional(),
  /**
   * How many files the unit itself may name (by path notation: a slash, an extension, a link): `min` and `max`. A
   * unit outside the range is refused with its reason and builds nothing, so a label made for a unit that names no
   * file (its file is in the next unit), or for a unit that names several, is not taken for a unit that does not fit.
   */
  paths: z
    .strictObject({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })
    .optional(),
  /** A unit with this label states when its target unit applies: it becomes the situation of the target's atom. */
  condition: z.literal(true).optional(),
  /** The span kinds a unit with this label may carry. */
  spans: z.array(z.string().min(1)).min(1).optional(),
  /** The link kinds a unit with this label may carry. */
  links: z.array(z.string().min(1)).min(1).optional(),
  atom: AtomMapping.optional(),
});
export type Label = z.infer<typeof Label>;

export const LabelSet = z.strictObject({
  set: z.string().regex(SET_NAME, { error: 'a set name is letters, digits, underscores and hyphens' }),
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
    const nesting = nestingProblem(set);
    if (nesting) return { ok: false, message: nesting };
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
      for (const kind of label.spans ?? []) {
        const parent = set.spans?.find((candidate) => candidate.name === kind)?.within;
        if (parent && !label.spans?.includes(parent)) {
          return {
            ok: false,
            message: `the label ${label.name} carries the span kind ${kind}, which is within ${parent}, and not ${parent}`,
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

/** True when `outer` is the parent of `kind`, or its parent's parent, and so on up the chain. */
function ancestor(kinds: ReadonlyMap<string, SpanKind>, kind: string, outer: string): boolean {
  let up = kinds.get(kind)?.within;
  for (let step = 0; up !== undefined && step < kinds.size; step += 1) {
    if (up === outer) return true;
    up = kinds.get(up)?.within;
  }
  return false;
}

/** Why the `within` of the span kinds of a set cannot be followed, or undefined when it can. */
function nestingProblem(set: LabelSet): string | undefined {
  const parents = new Map((set.spans ?? []).map((kind) => [kind.name, kind.within]));
  for (const [name, parent] of parents) {
    if (parent === undefined) continue;
    if (parent === name) return `the span kind ${name} is within itself`;
    if (!parents.has(parent))
      return `the span kind ${name} is within ${parent}, which the set does not declare`;
    // The chain above a kind has at most as many steps as there are kinds; a longer one loops.
    let up: string | undefined = parent;
    for (let step = 0; up !== undefined && step < parents.size; step += 1) up = parents.get(up);
    if (up !== undefined) return `the span kinds ${name} and ${parent} are within each other`;
  }
  return undefined;
}

/** The hash of a set's canonical form: editing one label changes only that set's hash. */
export const setHash = (set: LabelSet): string => sha(canonical(set)).slice(0, 16);

/** One unit as the labeler sees it: a number valid in this window only. */
export type WindowUnit = { n: number; text: string; index: number };

/** A line the labeler reads and cannot label: an opaque unit (a fence or a comment) shown by its kind and first line. */
export type ShownLine = { after: number; text: string };

/**
 * A run of units, cut at headings, that one request labels. `index` is the unit's place in its file. `shown` holds
 * the display-only lines of the opaque units in the run: `after` is the number of labelable units before the line.
 */
export type Window = {
  id: string;
  path: string;
  headingPath: string[];
  units: WindowUnit[];
  shown?: ShownLine[];
};

/** What a labeler says about a window: a label per unit or range, and a target for a label that needs one. */
export type Labelled = {
  units: string;
  label: string;
  target?: number;
  spans?: SpanInput[];
  links?: LinkAnswer[];
};

/** A span as answered: offsets into the text of one unit, `to` exclusive. */
export type SpanAnswer = { kind: string; from: number; to: number; polarity?: string };

/** A span as a labeler may write it: offsets into the unit, or the words of the clause, copied from the unit. */
export type SpanInput = { kind: string; polarity?: string } & (
  | { from: number; to: number; unlocated?: string }
  | { text: string }
);

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
  /** Spans and links dropped from accepted answers, with the reason: the label stood without them. */
  dropped: string[];
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
  const dropped: string[] = [];
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
    dropped.push(...extras.dropped.map((reason) => `${window.id}: ${reason}`));
    const { dropped: _dropped, ...kept } = extras;
    for (const n of numbers) {
      covered.add(n);
      if (entry.label !== 'none') {
        accepted.set(n, {
          label: entry.label,
          ...(entry.target !== undefined ? { target: entry.target } : {}),
          ...kept,
        });
      }
    }
  }
  return { accepted, covered, refusals, dropped };
}

const POLARITIES = new Set(['obligation', 'prohibition']);

/**
 * A unit as the labeler reads it: runs of white space become one space and the ends are trimmed. `at[i]` is the
 * offset in the unit of the character `i` of the shown text, so an offset counted on the shown text is carried
 * back to the unit's own text, which the atom quotes.
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
 * Where the words of a clause sit in the text of a unit: found without regard to case, exactly once. The slice
 * kept is the unit's own text, never the copy. `reason` says why not.
 */
export function locateSpanText(
  unitText: string,
  words: string,
): { from: number; to: number } | { reason: string } {
  const lower = unitText.toLowerCase();
  const wanted = words.toLowerCase();
  const first = wanted === '' || lower.length !== unitText.length ? -1 : lower.indexOf(wanted);
  if (first < 0) return { reason: 'the text is not in the unit' };
  if (lower.indexOf(wanted, first + 1) >= 0) return { reason: 'the text is found twice in the unit' };
  return { from: first, to: first + wanted.length };
}

/**
 * Turns the spans a labeler wrote as words into offsets, so the words never reach a cassette. A text that cannot
 * be located becomes an offset pair that no unit holds, with the reason code gave, and the check of the answer
 * refuses it with that reason.
 */
export function offsetSpans(entries: readonly Labelled[], window: Window): Labelled[] {
  return entries.map((entry) => {
    if (!entry.spans) return entry;
    // The words of a span never reach a cassette. An entry that cannot carry spans (a range, or a unit the window
    // does not hold) keeps none of them: the span stays as an offset pair no unit holds, and the check of the answer
    // drops it with its reason.
    const unit = /^\d+$/.test(entry.units.trim())
      ? window.units.find((candidate) => candidate.n === Number(entry.units))
      : undefined;
    if (!unit)
      return {
        ...entry,
        spans: entry.spans.map((span) => {
          if (span === null || typeof span !== 'object' || !('text' in span)) return span;
          const { text: _text, ...rest } = span;
          return { ...rest, from: -1, to: -1, unlocated: 'the entry is not one unit of the window' };
        }),
      };
    const shown = flatten(unit.text).text;
    // A text the unit holds N times and the entry lists N times (two gates that read one file) is located one
    // occurrence for each listing, in the order listed. Fewer listings than occurrences stay ambiguous.
    const listed = new Map<string, number>();
    for (const span of entry.spans)
      if (span !== null && typeof span === 'object' && 'text' in span && typeof span.text === 'string')
        listed.set(span.text.toLowerCase(), (listed.get(span.text.toLowerCase()) ?? 0) + 1);
    const taken = new Map<string, number>();
    return {
      ...entry,
      spans: entry.spans.map((span) => {
        if (span === null || typeof span !== 'object' || !('text' in span) || typeof span.text !== 'string')
          return span;
        const { text, ...rest } = span;
        const key = text.toLowerCase();
        const lower = shown.toLowerCase();
        const occurrences = key === '' || lower.length !== shown.length ? 0 : lower.split(key).length - 1;
        if (occurrences > 1 && occurrences === listed.get(key)) {
          const nth = taken.get(key) ?? 0;
          taken.set(key, nth + 1);
          let from = -1;
          for (let seen = 0; seen <= nth; seen++) from = lower.indexOf(key, from + 1);
          return { ...rest, from, to: from + key.length };
        }
        const found = locateSpanText(shown, text);
        return 'reason' in found
          ? { ...rest, from: -1, to: -1, unlocated: found.reason }
          : { ...rest, ...found };
      }),
    };
  });
}

/**
 * The spans and links of one entry, checked. A span is the words of a clause, or offsets, on the text the labeler
 * was shown: inside the unit, of a kind the label may carry, with a polarity only where the kind has one, and never
 * overlapping another span of the unit. The offsets kept are those of the unit's own text. A link names a kind the
 * label may carry and a candidate the request listed (or `none`). A span or a link that fails is DROPPED, with its
 * reason in `dropped`, and the label stands: the label is the answer, the clauses and links are notes on it, and a
 * wrong note costs the note, not the unit. An atom whose mapping needs a dropped note is refused later, with its
 * reason. Only a malformed shape (an empty or non-list `spans` or `links`) refuses the entry.
 */
function checkExtras(
  set: LabelSet,
  window: Window,
  entry: Labelled,
  numbers: readonly number[],
  label: Label | undefined,
  context: LabelContext,
): string | { spans?: SpanAnswer[]; links?: LinkAnswer[]; dropped: string[] } {
  const out: { spans?: SpanAnswer[]; links?: LinkAnswer[]; dropped: string[] } = { dropped: [] };
  if (entry.spans !== undefined) {
    if (!Array.isArray(entry.spans) || entry.spans.length === 0) return 'spans are a non-empty list';
    const unit =
      numbers.length === 1 ? window.units.find((candidate) => candidate.n === numbers[0]) : undefined;
    if (numbers.length !== 1) {
      out.dropped.push(`"${entry.units}" is a range, and a range cannot carry spans`);
    } else if (!label?.spans) {
      out.dropped.push(`the label ${entry.label} carries no spans`);
    } else if (!unit) {
      out.dropped.push(`"${entry.units}" leaves the window`);
    } else {
      const kinds = new Map((set.spans ?? []).map((kind) => [kind.name, kind]));
      const seen: SpanAnswer[] = [];
      const counted: Array<{ kind: string; from: number; to: number; where: string }> = [];
      const shown = flatten(unit.text);
      for (const span of entry.spans) {
        const where = `unit [${unit.n}] span ${JSON.stringify(span)}`;
        const refuse = (reason: string) => out.dropped.push(reason);
        if (span === null || typeof span !== 'object') {
          refuse(`${where} is no span`);
          continue;
        }
        const kind = typeof span.kind === 'string' ? kinds.get(span.kind) : undefined;
        if (!kind || !label.spans.includes(kind.name)) {
          refuse(
            `${where}: the kind ${JSON.stringify(span.kind)} is not one the label ${entry.label} may carry`,
          );
          continue;
        }
        // The words of the clause are located in the text the labeler was shown (white space made one space) by
        // code: found exactly once, else dropped. The model is bad at counting characters and good at copying; a
        // copied text enters nowhere unless it is a slice.
        let from: number;
        let to: number;
        if ('text' in span && typeof span.text === 'string') {
          const found = locateSpanText(shown.text, span.text);
          if ('reason' in found) {
            refuse(`${where}: ${found.reason}`);
            continue;
          }
          ({ from, to } = found);
        } else if ('from' in span && Number.isInteger(span.from) && Number.isInteger(span.to)) {
          if ('unlocated' in span && typeof span.unlocated === 'string') {
            refuse(`${where}: ${span.unlocated}`);
            continue;
          }
          ({ from, to } = span);
          if (from < 0 || to > shown.text.length || from >= to) {
            refuse(`${where}: offsets leave the unit (length ${shown.text.length}) or are empty`);
            continue;
          }
        } else {
          refuse(`${where}: offsets are integers, or the text is a string`);
          continue;
        }
        if (span.polarity !== undefined && span.polarity !== null) {
          if (!kind.polarity) {
            refuse(`${where}: the kind ${kind.name} carries no polarity`);
            continue;
          }
          if (typeof span.polarity !== 'string' || !POLARITIES.has(span.polarity)) {
            refuse(`${where}: the polarity is obligation or prohibition`);
            continue;
          }
        }
        counted.push({ kind: span.kind, from, to, where });
        seen.push({
          kind: span.kind,
          from: shown.at[from] as number,
          to: (shown.at[to - 1] as number) + 1,
          ...(span.polarity !== undefined && span.polarity !== null ? { polarity: span.polarity } : {}),
        });
      }
      // A span of a nested kind lies inside a span of its parent kind, wherever that one is in the entry. Against
      // any other span a span may not overlap: of two that clash, the later one is dropped.
      const kept = counted.map(() => true);
      for (const [index, span] of counted.entries()) {
        const outer = kinds.get(span.kind)?.within;
        if (
          outer !== undefined &&
          !counted.some((o) => o.kind === outer && o.from <= span.from && span.to <= o.to)
        ) {
          kept[index] = false;
          out.dropped.push(`${span.where} is not inside a span of the kind ${outer}`);
          continue;
        }
        const clash = counted
          .slice(0, index)
          .some(
            (o, before) =>
              kept[before] &&
              span.from < o.to &&
              o.from < span.to &&
              !ancestor(kinds, span.kind, o.kind) &&
              !ancestor(kinds, o.kind, span.kind),
          );
        if (clash) {
          kept[index] = false;
          out.dropped.push(`${span.where} overlaps another span of the unit`);
        }
      }
      const spans = seen.filter((_, index) => kept[index]);
      // A label whose atom pairs each gate's act span with its file span (`spanFile`) keeps the spans in the order the
      // labeler listed them: the file span that follows an act span is that gate's own. Any other label is sorted.
      if (spans.length > 0)
        out.spans =
          label?.atom?.spanFile !== undefined ? spans : spans.sort((a, b) => a.from - b.from || b.to - a.to);
    }
  }
  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links) || entry.links.length === 0) return 'links are a non-empty list';
    if (!label?.links) {
      out.dropped.push(`the label ${entry.label} carries no links`);
    } else {
      const kinds = new Map((set.links ?? []).map((kind) => [kind.name, kind]));
      const links: LinkAnswer[] = [];
      for (const link of entry.links) {
        const where = `units "${entry.units}" link ${JSON.stringify(link)}`;
        if (link === null || typeof link !== 'object') {
          out.dropped.push(`${where} is no link`);
          continue;
        }
        const kind = typeof link.kind === 'string' ? kinds.get(link.kind) : undefined;
        if (!kind || !label.links.includes(kind.name)) {
          out.dropped.push(
            `${where}: the kind ${JSON.stringify(link.kind)} is not one the label ${entry.label} may carry`,
          );
          continue;
        }
        if (typeof link.to !== 'string') {
          out.dropped.push(`${where}: the target is an atom id or none`);
          continue;
        }
        // A kind may link several atoms (a routing row naming two skills); a repeat that names the same atom,
        // none, or a second value of a closed list is dropped.
        if (
          links.some(
            (other) =>
              other.kind === kind.name &&
              (other.to === link.to ||
                other.to === 'none' ||
                link.to === 'none' ||
                kind.values !== undefined),
          )
        ) {
          out.dropped.push(`${where}: the kind ${kind.name} is given twice`);
          continue;
        }
        if (link.to !== 'none') {
          const listed = context.candidates?.[kind.name] ?? [];
          if (!listed.some((candidate) => candidate.id === link.to)) {
            out.dropped.push(`${where}: ${link.to} is not an atom the request listed for ${kind.name}`);
            continue;
          }
        }
        links.push({ kind: kind.name, to: link.to });
      }
      if (links.length > 0) out.links = links;
    }
  }
  return out;
}
