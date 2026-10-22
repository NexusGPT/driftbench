import { parse } from 'yaml';
import type { LabelDef, LabelSetDef, ScanFailure } from '../../../src/ladders/pointer/sut/port';
import { canonicalCompact, sha256 } from './hash';

/** The `agent-rules` set of design section 1, shipped as data. */
export const DEFAULT_LABELS_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        target: required
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;

/** A label file the reference refuses: the words, and the structured cause the reader gives (`failure`). */
export class LabelSetError extends Error {
  constructor(
    message: string,
    readonly failure: ScanFailure,
  ) {
    super(message);
  }
}

const NAME = /^[a-z][a-z0-9_-]*$/;

/** The name of a set, label or kind as written, when it is a string. */
const written = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Refuses the file: `code` and `reason` are the stable cause, `fields` the names it is about. */
function fail(
  message: string,
  code: string,
  reason: string,
  fields: Omit<ScanFailure, 'code' | 'reason'> = {},
): never {
  const named: ScanFailure = { code, reason };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (named as Record<string, unknown>)[key] = value;
  }
  throw new LabelSetError(message, named);
}

/** A kind of span inside one unit (design section 1, the reader's `spans:` of a set). */
export type SpanKindDef = { name: string; description: string; polarity?: true; within?: string };
/** A kind of link to a listed candidate: the atom kinds it names, or a closed list of values. */
export type LinkKindDef = { name: string; description: string; to?: string[]; values?: string[] };
/** A label that may also carry spans and links of the kinds its set declares. */
export type RefLabel = LabelDef & { spans?: string[]; links?: string[] };
/** What a mapping adds to its kind and polarity: a title and a situation (templates), and `whenFile`. */
export type MappingExtra = { title?: string; situation?: string; whenFile?: true };

export type ParsedSet = Omit<LabelSetDef, 'labels'> & {
  hash: string;
  labels: RefLabel[];
  /** The span kinds of the set; absent when it declares none. */
  spans?: SpanKindDef[];
  /** The link kinds of the set; absent when it declares none. */
  links?: LinkKindDef[];
  /** The title, situation and `whenFile` of each label's atom mapping, by label name (not enumerable). */
  mappings: Map<string, MappingExtra>;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : undefined;

/** The span kinds or link kinds a set declares, each with a name and a description. */
function kindsOf(set: Record<string, unknown>, field: 'spans' | 'links'): Array<Record<string, unknown>> {
  const raw = set[field];
  if (raw === undefined) return [];
  const inSet = written(set.set);
  const what = field === 'spans' ? 'span' : 'link';
  if (!Array.isArray(raw) || raw.length === 0)
    fail(`the set "${String(set.set)}" has an empty ${field} list`, 'set-field-invalid', 'invalid-field', {
      set: inSet,
    });
  const seen = new Set<string>();
  return (raw as unknown[]).map((entry) => {
    const kind = (entry ?? {}) as Record<string, unknown>;
    if (typeof kind.name !== 'string' || !NAME.test(kind.name))
      fail(
        `a ${field} kind of the set "${String(set.set)}" has no lower-case name`,
        `${what}-kind-name-invalid`,
        'not-an-identifier',
        { set: inSet, kind: written(kind.name) },
      );
    if (typeof kind.description !== 'string' || kind.description.trim() === '')
      fail(`the ${field} kind ${kind.name} has no description`, 'set-field-invalid', 'invalid-field', {
        set: inSet,
      });
    if (seen.has(kind.name))
      fail(
        `the set "${String(set.set)}" declares the ${field} kind ${kind.name} twice`,
        `${what}-kind-duplicate`,
        'duplicate',
        { set: inSet, kind: kind.name },
      );
    seen.add(kind.name);
    return kind;
  });
}

export function parseLabelSets(yamlText: string | undefined): ParsedSet[] {
  let data: unknown;
  try {
    data = parse(yamlText ?? DEFAULT_LABELS_YAML);
  } catch (cause) {
    fail(
      `the label file is not valid YAML: ${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}`,
      'label-file-not-yaml',
      'not-yaml',
    );
  }
  const root = data as { labels?: unknown };
  if (!root || !Array.isArray(root.labels) || root.labels.length === 0)
    fail('the label file has no `labels:` list of sets', 'label-file-invalid', 'invalid-file');
  const names = new Set<string>();
  const out: ParsedSet[] = [];
  for (const raw of root.labels as unknown[]) {
    const set = raw as Record<string, unknown>;
    if (typeof set.set !== 'string' || set.set === '')
      fail('a label set has no `set:` name', 'set-name-invalid', 'not-an-identifier', { set: written(set.set) });
    if (names.has(set.set))
      fail(`the set name "${set.set}" is used twice`, 'set-duplicate', 'duplicate', { set: set.set });
    names.add(set.set);
    if (!Array.isArray(set.labels) || set.labels.length === 0)
      fail(`the set "${set.set}" has no labels`, 'set-field-invalid', 'invalid-field', { set: set.set });
    const spanKinds = kindsOf(set, 'spans').map(
      (kind): SpanKindDef => ({
        name: kind.name as string,
        description: kind.description as string,
        ...(kind.polarity === true ? { polarity: true as const } : {}),
        ...(typeof kind.within === 'string' ? { within: kind.within } : {}),
      }),
    );
    const linkKinds = kindsOf(set, 'links').map((kind): LinkKindDef => {
      const to = strings(kind.to);
      const values = strings(kind.values);
      if ((to === undefined) === (values === undefined))
        fail(
          `the link kind ${String(kind.name)} names \`to\` or \`values\`, one of the two`,
          'link-kind-shape-invalid',
          'to-or-values',
          { set: set.set, kind: written(kind.name) },
        );
      return {
        name: kind.name as string,
        description: kind.description as string,
        ...(to ? { to } : {}),
        ...(values ? { values } : {}),
      };
    });
    const seen = new Set<string>();
    const labels: RefLabel[] = [];
    const mappings = new Map<string, MappingExtra>();
    for (const rawLabel of set.labels as unknown[]) {
      const label = rawLabel as Record<string, unknown>;
      const name = label.name;
      if (typeof name !== 'string' || !NAME.test(name)) {
        fail(
          `the label name ${JSON.stringify(name)} in the set "${set.set}" is not a lower-case identifier`,
          'label-name-invalid',
          'not-an-identifier',
          { set: set.set, label: written(name) },
        );
      }
      if (name === 'none')
        fail(`the label name "none" in the set "${set.set}" is reserved`, 'label-name-reserved', 'reserved', {
          set: set.set,
          label: name,
        });
      if (seen.has(name))
        fail(`the label "${name}" is repeated in the set "${set.set}"`, 'label-duplicate', 'duplicate', {
          set: set.set,
          label: name,
        });
      seen.add(name);
      if (typeof label.description !== 'string' || label.description.trim() === '') {
        fail(
          `the label "${name}" in the set "${set.set}" has no description`,
          'label-field-invalid',
          'invalid-field',
          { set: set.set, label: name },
        );
      }
      if (label.target !== undefined && label.target !== 'required') {
        fail(
          `the label "${name}" in the set "${set.set}" has target ${JSON.stringify(label.target)}, only "required" is allowed`,
          'label-target-invalid',
          'target-is-required-only',
          { set: set.set, label: name },
        );
      }
      if (label.condition !== undefined && label.condition !== true)
        fail(
          `the label "${name}" in the set "${set.set}" has condition ${JSON.stringify(label.condition)}, only true is allowed`,
          'label-field-invalid',
          'invalid-field',
          { set: set.set, label: name },
        );
      if (label.condition === true && label.target !== 'required')
        fail(
          `the label "${name}" is a condition and needs target: required`,
          'label-condition-needs-target',
          'condition-without-target',
          { set: set.set, label: name },
        );
      if (label.condition === true && label.atom !== undefined)
        fail(
          `the label "${name}" is a condition and builds no atom of its own: it takes no atom mapping`,
          'label-condition-takes-no-atom',
          'condition-with-atom',
          { set: set.set, label: name },
        );
      const def: RefLabel = { name, description: label.description };
      if (label.condition === true) def.condition = true;
      if (Array.isArray(label.examples)) def.examples = label.examples.map(String);
      if (label.target === 'required') def.target = 'required';
      if (label.atom && typeof label.atom === 'object') {
        const atom = label.atom as Record<string, unknown>;
        if (typeof atom.kind !== 'string')
          fail(`the atom mapping of "${name}" has no kind`, 'label-field-invalid', 'invalid-field', {
            set: set.set,
            label: name,
          });
        def.atom = {
          kind: atom.kind,
          ...(typeof atom.polarity === 'string' ? { polarity: atom.polarity } : {}),
        };
        const extra: MappingExtra = {
          ...(typeof atom.title === 'string' && atom.title !== '' ? { title: atom.title } : {}),
          ...(typeof atom.situation === 'string' && atom.situation !== ''
            ? { situation: atom.situation }
            : {}),
          ...(atom.whenFile === true ? { whenFile: true as const } : {}),
        };
        if (Object.keys(extra).length > 0) mappings.set(name, extra);
      }
      for (const field of ['spans', 'links'] as const) {
        if (label[field] === undefined) continue;
        const names = strings(label[field]);
        const declared = field === 'spans' ? spanKinds : linkKinds;
        const what = field === 'spans' ? 'span' : 'link';
        if (!names)
          fail(`the label "${name}" has an empty ${field} list`, 'label-field-invalid', 'invalid-field', {
            set: set.set,
            label: name,
          });
        for (const kind of names)
          if (!declared.some((k) => k.name === kind))
            fail(
              `the label ${name} names the ${what} kind ${kind}, which the set does not declare`,
              `label-${what}-kind-undeclared`,
              'undeclared',
              { set: set.set, label: name, kind },
            );
        def[field] = names;
      }
      labels.push(def);
    }
    const parsed: Omit<ParsedSet, 'hash' | 'mappings'> = {
      set: set.set,
      description: typeof set.description === 'string' ? set.description : '',
      labels,
      ...(spanKinds.length > 0 ? { spans: spanKinds } : {}),
      ...(linkKinds.length > 0 ? { links: linkKinds } : {}),
    };
    // The set hash covers what the set declares: the mapping templates join it when the set has any. A set
    // with no spans, links or templates hashes as it did before the reference knew them.
    const declared = { ...parsed, ...(mappings.size > 0 ? { mappings: Object.fromEntries(mappings) } : {}) };
    // The mapping extras are not enumerable: a set copied or serialised whole (a fixture wire) stays the set
    // it was before the reference knew them.
    out.push(
      Object.defineProperty(
        { ...parsed, labels, hash: sha256(canonicalCompact(declared)).slice(0, 16) },
        'mappings',
        { value: mappings },
      ) as ParsedSet,
    );
  }
  return out;
}
