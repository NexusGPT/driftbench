import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { EvidencePredicate } from '../schema';
import { type PointerDiagnostic, record } from './codes';
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
  evidence: z.array(EvidencePredicate).optional(),
  /** Resolve the first path the unit names as a file of the estate: the atom gets its path and whether it exists. `each`: one atom per path the unit names. */
  locate: z.union([z.literal(true), z.literal('each')]).optional(),
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

/**
 * Why a label file is refused, beside the text. `code` is stable; `reason` is the short cause; `set`, `label` and
 * `kind` are the offending names as written; `path` is the dotted place of the first schema issue.
 */
export type LabelSetsFailure = {
  ok: false;
  message: string;
  code: string;
  reason: string;
  set?: string;
  label?: string;
  kind?: string;
  parent?: string;
  path?: string;
};

/** What a label file gives, with the structured reason of a refusal. */
export type LabelSetsOutcome = { ok: true; sets: LabelSet[] } | LabelSetsFailure;

export type LabelSetsResult = { ok: true; sets: LabelSet[] } | { ok: false; message: string };

type FailureFields = Partial<Omit<LabelSetsFailure, 'ok' | 'message' | 'code' | 'reason'>>;

const refuseSets = (
  code: string,
  reason: string,
  message: string,
  fields: FailureFields = {},
): LabelSetsFailure => {
  const out: LabelSetsFailure = { ok: false, message, code, reason };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a path of the raw label file, or undefined when the path leaves it. */
function at(raw: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let value: unknown = raw;
  for (const key of path) {
    if (Array.isArray(value) && typeof key === 'number') value = value[key];
    else if (isObject(value) && typeof key === 'string') value = value[key];
    else return undefined;
  }
  return value;
}

const nameOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * The code and the offending names of the first schema issue. The place of the issue says which field of which
 * set or label it is; the raw file gives the set and label that hold it.
 */
function schemaFailure(
  raw: unknown,
  issue: { path: ReadonlyArray<PropertyKey>; code: string },
  message: string,
): LabelSetsFailure {
  const path = issue.path;
  const dotted = path.map(String).join('.');
  const tail = path[path.length - 1];
  const inSet = path[0] === 'labels' && typeof path[1] === 'number';
  const set = inSet ? nameOf(at(raw, ['labels', path[1] as number, 'set'])) : undefined;
  const inLabel = inSet && path[2] === 'labels' && typeof path[3] === 'number';
  const label = inLabel
    ? nameOf(at(raw, ['labels', path[1] as number, 'labels', path[3] as number, 'name']))
    : undefined;
  const found = nameOf(at(raw, path));
  const base: FailureFields = { path: dotted, ...(set !== undefined ? { set } : {}) };
  if (inSet && path.length === 3 && tail === 'set') {
    return refuseSets('set-name-invalid', 'not-an-identifier', message, { ...base, set: found });
  }
  if (inLabel && tail === 'name' && path.length === 5) {
    return issue.code === 'custom'
      ? refuseSets('label-name-reserved', 'reserved', message, { ...base, label: found })
      : refuseSets('label-name-invalid', 'not-an-identifier', message, { ...base, label: found });
  }
  if (inLabel && tail === 'examples') {
    return refuseSets('label-examples-too-many', 'more-than-three-examples', message, { ...base, label });
  }
  if (inLabel && tail === 'target') {
    return refuseSets('label-target-invalid', 'target-is-required-only', message, { ...base, label });
  }
  if (inSet && path[2] === 'spans' && tail === 'name') {
    return refuseSets('span-kind-name-invalid', 'not-an-identifier', message, { ...base, kind: found });
  }
  if (inSet && path[2] === 'links' && tail === 'name') {
    return refuseSets('link-kind-name-invalid', 'not-an-identifier', message, { ...base, kind: found });
  }
  if (inSet && path[2] === 'spans' && tail === 'within') {
    return refuseSets('span-kind-within-invalid', 'not-an-identifier', message, { ...base, parent: found });
  }
  if (inSet && path[2] === 'links' && typeof path[3] === 'number' && path.length === 4) {
    const kind = nameOf(at(raw, ['labels', path[1] as number, 'links', path[3] as number, 'name']));
    return refuseSets('link-kind-shape-invalid', 'to-or-values', message, { ...base, kind });
  }
  if (inLabel) return refuseSets('label-field-invalid', 'invalid-field', message, { ...base, label });
  if (inSet) return refuseSets('set-field-invalid', 'invalid-field', message, base);
  return refuseSets('label-file-invalid', 'invalid-file', message, base);
}

/** Reads the `labels:` list of a YAML text, and refuses a duplicate set or label name. */
export function parseLabelSets(text: string): LabelSetsResult {
  const read = parseLabelSetsDetailed(text);
  return read.ok ? read : { ok: false, message: read.message };
}

/**
 * The same read as `parseLabelSets`, and a refusal that also carries a `code`, a `reason` and the offending
 * `set`, `label` or `kind` as written.
 */
export function parseLabelSetsDetailed(text: string): LabelSetsOutcome {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return refuseSets(
      'label-file-not-yaml',
      'not-yaml',
      cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    );
  }
  const parsed = LabelFile.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.map(String).join('.') ?? '';
    const message = `${path ? `${path}: ` : ''}${first?.message ?? 'unknown problem'}`;
    return first
      ? schemaFailure(raw, first, message)
      : refuseSets('label-file-invalid', 'invalid-file', message);
  }
  const seen = new Set<string>();
  for (const set of parsed.data.labels) {
    if (seen.has(set.set)) {
      return refuseSets('set-duplicate', 'duplicate', `the set ${set.set} is declared twice`, {
        set: set.set,
      });
    }
    seen.add(set.set);
    const spanKinds = new Set<string>();
    for (const kind of set.spans ?? []) {
      if (spanKinds.has(kind.name)) {
        return refuseSets(
          'span-kind-duplicate',
          'duplicate',
          `the set ${set.set} declares the span kind ${kind.name} twice`,
          { set: set.set, kind: kind.name },
        );
      }
      spanKinds.add(kind.name);
    }
    const nesting = nestingProblem(set);
    if (nesting) return nesting;
    const linkKinds = new Set<string>();
    for (const kind of set.links ?? []) {
      if (linkKinds.has(kind.name)) {
        return refuseSets(
          'link-kind-duplicate',
          'duplicate',
          `the set ${set.set} declares the link kind ${kind.name} twice`,
          { set: set.set, kind: kind.name },
        );
      }
      linkKinds.add(kind.name);
    }
    const names = new Set<string>();
    for (const label of set.labels) {
      for (const kind of label.spans ?? []) {
        if (!spanKinds.has(kind)) {
          return refuseSets(
            'label-span-kind-undeclared',
            'undeclared',
            `the label ${label.name} names the span kind ${kind}, which the set does not declare`,
            { set: set.set, label: label.name, kind },
          );
        }
      }
      for (const kind of label.links ?? []) {
        if (!linkKinds.has(kind)) {
          return refuseSets(
            'label-link-kind-undeclared',
            'undeclared',
            `the label ${label.name} names the link kind ${kind}, which the set does not declare`,
            { set: set.set, label: label.name, kind },
          );
        }
      }
      for (const kind of label.spans ?? []) {
        const parent = set.spans?.find((candidate) => candidate.name === kind)?.within;
        if (parent && !label.spans?.includes(parent)) {
          return refuseSets(
            'label-span-parent-missing',
            'parent-not-carried',
            `the label ${label.name} carries the span kind ${kind}, which is within ${parent}, and not ${parent}`,
            { set: set.set, label: label.name, kind, parent },
          );
        }
      }
      if (names.has(label.name)) {
        return refuseSets('label-duplicate', 'duplicate', `the set ${set.set} declares ${label.name} twice`, {
          set: set.set,
          label: label.name,
        });
      }
      names.add(label.name);
      if (label.condition && label.target !== 'required') {
        return refuseSets(
          'label-condition-needs-target',
          'condition-without-target',
          `the label ${label.name} is a condition and needs target: required`,
          { set: set.set, label: label.name },
        );
      }
      if (label.condition && label.atom) {
        return refuseSets(
          'label-condition-takes-no-atom',
          'condition-with-atom',
          `the label ${label.name} is a condition and builds no atom of its own: it takes no atom mapping`,
          { set: set.set, label: label.name },
        );
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
function nestingProblem(set: LabelSet): LabelSetsFailure | undefined {
  const parents = new Map((set.spans ?? []).map((kind) => [kind.name, kind.within]));
  for (const [name, parent] of parents) {
    if (parent === undefined) continue;
    if (parent === name) {
      return refuseSets('span-kind-within-itself', 'cycle', `the span kind ${name} is within itself`, {
        set: set.set,
        kind: name,
        parent,
      });
    }
    if (!parents.has(parent)) {
      return refuseSets(
        'span-kind-within-undeclared',
        'undeclared',
        `the span kind ${name} is within ${parent}, which the set does not declare`,
        { set: set.set, kind: name, parent },
      );
    }
    // The chain above a kind has at most as many steps as there are kinds; a longer one loops.
    let up: string | undefined = parent;
    for (let step = 0; up !== undefined && step < parents.size; step += 1) up = parents.get(up);
    if (up !== undefined) {
      return refuseSets(
        'span-kind-within-cycle',
        'cycle',
        `the span kinds ${name} and ${parent} are within each other`,
        { set: set.set, kind: name, parent },
      );
    }
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
  /** One record for each text of `refusals`, in the same order: a code and the identifiers the text names. */
  refusalRecords: PointerDiagnostic[];
  /** Spans and links dropped from accepted answers, with the reason: the label stood without them. */
  dropped: string[];
  /** One record for each text of `dropped`, in the same order. */
  droppedRecords: PointerDiagnostic[];
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
  const refusalRecords: PointerDiagnostic[] = [];
  const dropped: string[] = [];
  const droppedRecords: PointerDiagnostic[] = [];
  const refuse = (
    code: string,
    reason: string,
    fields: Partial<Omit<PointerDiagnostic, 'code' | 'detail'>> = {},
  ) => {
    const detail = `${window.id}: ${reason}`;
    refusals.push(detail);
    refusalRecords.push(record(code, detail, { window: window.id, set: set.set, ...fields }));
  };
  for (const entry of answer) {
    const label = allowed.get(entry.label);
    if (entry.label !== 'none' && !label) {
      refuse('label-not-in-set', `the label ${entry.label} is not in the set ${set.set}`, {
        label: entry.label,
        units: entry.units,
      });
      continue;
    }
    const numbers = expandUnits(entry.units);
    if (!numbers) {
      refuse('units-malformed', `"${entry.units}" is no unit number or range`, {
        units: entry.units,
        label: entry.label,
      });
      continue;
    }
    if (numbers.some((n) => !inWindow.has(n))) {
      refuse('units-leave-window', `"${entry.units}" leaves the window`, {
        units: entry.units,
        label: entry.label,
      });
      continue;
    }
    if (numbers.some((n) => covered.has(n))) {
      refuse('units-already-labelled', `"${entry.units}" names a unit that is already labelled`, {
        units: entry.units,
        label: entry.label,
      });
      continue;
    }
    if (entry.target !== undefined && (typeof entry.target !== 'number' || !Number.isInteger(entry.target))) {
      refuse('target-malformed', `the target ${JSON.stringify(entry.target)} is no unit number`, {
        units: entry.units,
        label: entry.label,
      });
      continue;
    }
    if (entry.label === 'none' && entry.target !== undefined) {
      refuse('none-takes-no-target', 'the label none takes no target', {
        units: entry.units,
        label: entry.label,
        target: String(entry.target),
      });
      continue;
    }
    if (label?.target === 'required' && (entry.target === undefined || !inWindow.has(entry.target))) {
      refuse('target-required', `the label ${entry.label} needs a target unit inside the window`, {
        units: entry.units,
        label: entry.label,
        ...(entry.target !== undefined ? { target: String(entry.target) } : {}),
      });
      continue;
    }
    if (label && label.target !== 'required' && entry.target !== undefined) {
      refuse('target-not-taken', `the label ${entry.label} takes no target`, {
        units: entry.units,
        label: entry.label,
        target: String(entry.target),
      });
      continue;
    }
    const extras = checkExtras(set, window, entry, numbers, label, context);
    if ('refusal' in extras) {
      refuse(extras.code, extras.refusal, { units: entry.units, label: entry.label });
      continue;
    }
    dropped.push(...extras.dropped.map((reason) => `${window.id}: ${reason}`));
    droppedRecords.push(
      ...extras.droppedRecords.map((item) => ({
        ...item,
        detail: `${window.id}: ${item.detail}`,
        window: window.id,
        set: set.set,
      })),
    );
    const { dropped: _dropped, droppedRecords: _droppedRecords, ...kept } = extras;
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
  return { accepted, covered, refusals, refusalRecords, dropped, droppedRecords };
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

const TEXT_ABSENT = 'the text is not in the unit';
const TEXT_REPEATED = 'the text is found twice in the unit';

/** The code of a reason `locateSpanText` gives. */
const spanTextCode = (reason: string): string => {
  if (reason === TEXT_REPEATED) return 'span-text-repeated';
  return reason === TEXT_ABSENT ? 'span-text-absent' : 'span-text-unlocated';
};

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
  if (first < 0) return { reason: TEXT_ABSENT };
  if (lower.indexOf(wanted, first + 1) >= 0) return { reason: TEXT_REPEATED };
  return { from: first, to: first + wanted.length };
}

/**
 * Turns the spans a labeler wrote as words into offsets, so the words never reach a cassette. A text that cannot
 * be located becomes an offset pair that no unit holds, with the reason code gave, and the check of the answer
 * refuses it with that reason.
 */
export function offsetSpans(entries: readonly Labelled[], window: Window): Labelled[] {
  return entries.map((entry) => {
    if (!entry.spans || !/^\d+$/.test(entry.units.trim())) return entry;
    const unit = window.units.find((candidate) => candidate.n === Number(entry.units));
    if (!unit) return entry;
    return {
      ...entry,
      spans: entry.spans.map((span) => {
        if (span === null || typeof span !== 'object' || !('text' in span) || typeof span.text !== 'string')
          return span;
        const { text, ...rest } = span;
        const found = locateSpanText(flatten(unit.text).text, text);
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
type Extras = {
  spans?: SpanAnswer[];
  links?: LinkAnswer[];
  dropped: string[];
  /** One record for each text of `dropped`, in the same order. */
  droppedRecords: PointerDiagnostic[];
};

function checkExtras(
  set: LabelSet,
  window: Window,
  entry: Labelled,
  numbers: readonly number[],
  label: Label | undefined,
  context: LabelContext,
): { refusal: string; code: string } | Extras {
  const out: Extras = { dropped: [], droppedRecords: [] };
  const drop = (
    code: string,
    reason: string,
    fields: Partial<Omit<PointerDiagnostic, 'code' | 'detail'>> = {},
  ) => {
    out.dropped.push(reason);
    out.droppedRecords.push(record(code, reason, { label: entry.label, ...fields }));
  };
  if (entry.spans !== undefined) {
    if (!Array.isArray(entry.spans) || entry.spans.length === 0) {
      return { refusal: 'spans are a non-empty list', code: 'spans-malformed' };
    }
    const unit =
      numbers.length === 1 ? window.units.find((candidate) => candidate.n === numbers[0]) : undefined;
    if (numbers.length !== 1) {
      drop('span-range-unit', `"${entry.units}" is a range, and a range cannot carry spans`, {
        units: entry.units,
      });
    } else if (!label?.spans) {
      drop('label-carries-no-spans', `the label ${entry.label} carries no spans`, { units: entry.units });
    } else if (!unit) {
      drop('span-unit-leaves-window', `"${entry.units}" leaves the window`, { units: entry.units });
    } else {
      const kinds = new Map((set.spans ?? []).map((kind) => [kind.name, kind]));
      const seen: SpanAnswer[] = [];
      const counted: Array<{ kind: string; from: number; to: number; where: string; shown: string }> = [];
      const shown = flatten(unit.text);
      for (const span of entry.spans) {
        const where = `unit [${unit.n}] span ${JSON.stringify(span)}`;
        const own = { unit: String(unit.n) };
        const named = (value: unknown): { span?: string } =>
          typeof value === 'string' ? { span: value } : {};
        const refuse = (
          code: string,
          reason: string,
          fields: Partial<Omit<PointerDiagnostic, 'code' | 'detail'>> = {},
        ) => drop(code, reason, { ...own, ...fields });
        if (span === null || typeof span !== 'object') {
          refuse('span-malformed', `${where} is no span`);
          continue;
        }
        const kind = typeof span.kind === 'string' ? kinds.get(span.kind) : undefined;
        if (!kind || !label.spans.includes(kind.name)) {
          refuse(
            'span-kind-not-allowed',
            `${where}: the kind ${JSON.stringify(span.kind)} is not one the label ${entry.label} may carry`,
            { ...(typeof span.kind === 'string' ? { kind: span.kind } : {}) },
          );
          continue;
        }
        // The words of the clause are located in the text the labeler was shown (white space made one space) by
        // code: found exactly once, else dropped. The model is bad at counting characters and good at copying; a
        // copied text enters nowhere unless it is a slice.
        let from: number;
        let to: number;
        let shownSpan: string | undefined;
        if ('text' in span && typeof span.text === 'string') {
          const found = locateSpanText(shown.text, span.text);
          if ('reason' in found) {
            refuse(spanTextCode(found.reason), `${where}: ${found.reason}`, {
              kind: kind.name,
              ...named(span.text),
            });
            continue;
          }
          ({ from, to } = found);
          shownSpan = span.text;
        } else if ('from' in span && Number.isInteger(span.from) && Number.isInteger(span.to)) {
          if ('unlocated' in span && typeof span.unlocated === 'string') {
            refuse(spanTextCode(span.unlocated), `${where}: ${span.unlocated}`, { kind: kind.name });
            continue;
          }
          ({ from, to } = span);
          if (from < 0 || to > shown.text.length || from >= to) {
            refuse(
              'span-offsets-invalid',
              `${where}: offsets leave the unit (length ${shown.text.length}) or are empty`,
              { kind: kind.name, span: `${from}-${to}` },
            );
            continue;
          }
        } else {
          refuse('span-shape-invalid', `${where}: offsets are integers, or the text is a string`, {
            kind: kind.name,
          });
          continue;
        }
        if (span.polarity !== undefined && span.polarity !== null) {
          if (!kind.polarity) {
            refuse('span-polarity-not-allowed', `${where}: the kind ${kind.name} carries no polarity`, {
              kind: kind.name,
            });
            continue;
          }
          if (typeof span.polarity !== 'string' || !POLARITIES.has(span.polarity)) {
            refuse('span-polarity-invalid', `${where}: the polarity is obligation or prohibition`, {
              kind: kind.name,
            });
            continue;
          }
        }
        counted.push({ kind: span.kind, from, to, where, shown: shownSpan ?? `${from}-${to}` });
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
          drop('span-outside-parent', `${span.where} is not inside a span of the kind ${outer}`, {
            unit: String(unit.n),
            kind: span.kind,
            parent: outer,
            span: span.shown,
          });
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
          drop('span-overlap', `${span.where} overlaps another span of the unit`, {
            unit: String(unit.n),
            kind: span.kind,
            span: span.shown,
          });
        }
      }
      const spans = seen.filter((_, index) => kept[index]);
      if (spans.length > 0) out.spans = spans.sort((a, b) => a.from - b.from || b.to - a.to);
    }
  }
  if (entry.links !== undefined) {
    if (!Array.isArray(entry.links) || entry.links.length === 0) {
      return { refusal: 'links are a non-empty list', code: 'links-malformed' };
    }
    if (!label?.links) {
      drop('label-carries-no-links', `the label ${entry.label} carries no links`, { units: entry.units });
    } else {
      const kinds = new Map((set.links ?? []).map((kind) => [kind.name, kind]));
      const links: LinkAnswer[] = [];
      for (const link of entry.links) {
        const where = `units "${entry.units}" link ${JSON.stringify(link)}`;
        if (link === null || typeof link !== 'object') {
          drop('link-malformed', `${where} is no link`, { units: entry.units });
          continue;
        }
        const kind = typeof link.kind === 'string' ? kinds.get(link.kind) : undefined;
        if (!kind || !label.links.includes(kind.name)) {
          drop(
            'link-kind-not-allowed',
            `${where}: the kind ${JSON.stringify(link.kind)} is not one the label ${entry.label} may carry`,
            { units: entry.units, ...(typeof link.kind === 'string' ? { kind: link.kind } : {}) },
          );
          continue;
        }
        if (typeof link.to !== 'string') {
          drop('link-target-malformed', `${where}: the target is an atom id or none`, {
            units: entry.units,
            kind: kind.name,
          });
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
          drop('link-kind-repeated', `${where}: the kind ${kind.name} is given twice`, {
            units: entry.units,
            kind: kind.name,
            target: link.to,
          });
          continue;
        }
        if (link.to !== 'none') {
          const listed = context.candidates?.[kind.name] ?? [];
          if (!listed.some((candidate) => candidate.id === link.to)) {
            drop(
              'link-target-unlisted',
              `${where}: ${link.to} is not an atom the request listed for ${kind.name}`,
              { units: entry.units, kind: kind.name, target: link.to },
            );
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
