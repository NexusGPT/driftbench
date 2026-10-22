import { parse } from 'yaml';
import type { LabelDef, LabelSetDef } from '../../../src/ladders/pointer/sut/port';
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

export class LabelSetError extends Error {}

const NAME = /^[a-z][a-z0-9_-]*$/;

function fail(message: string): never {
  throw new LabelSetError(message);
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
  if (!Array.isArray(raw) || raw.length === 0)
    fail(`the set "${String(set.set)}" has an empty ${field} list`);
  const seen = new Set<string>();
  return (raw as unknown[]).map((entry) => {
    const kind = (entry ?? {}) as Record<string, unknown>;
    if (typeof kind.name !== 'string' || !NAME.test(kind.name))
      fail(`a ${field} kind of the set "${String(set.set)}" has no lower-case name`);
    if (typeof kind.description !== 'string' || kind.description.trim() === '')
      fail(`the ${field} kind ${kind.name} has no description`);
    if (seen.has(kind.name))
      fail(`the set "${String(set.set)}" declares the ${field} kind ${kind.name} twice`);
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
    );
  }
  const root = data as { labels?: unknown };
  if (!root || !Array.isArray(root.labels) || root.labels.length === 0)
    fail('the label file has no `labels:` list of sets');
  const names = new Set<string>();
  const out: ParsedSet[] = [];
  for (const raw of root.labels as unknown[]) {
    const set = raw as Record<string, unknown>;
    if (typeof set.set !== 'string' || set.set === '') fail('a label set has no `set:` name');
    if (names.has(set.set)) fail(`the set name "${set.set}" is used twice`);
    names.add(set.set);
    if (!Array.isArray(set.labels) || set.labels.length === 0) fail(`the set "${set.set}" has no labels`);
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
        fail(`the link kind ${String(kind.name)} names \`to\` or \`values\`, one of the two`);
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
        fail(`the label name ${JSON.stringify(name)} in the set "${set.set}" is not a lower-case identifier`);
      }
      if (name === 'none') fail(`the label name "none" in the set "${set.set}" is reserved`);
      if (seen.has(name)) fail(`the label "${name}" is repeated in the set "${set.set}"`);
      seen.add(name);
      if (typeof label.description !== 'string' || label.description.trim() === '') {
        fail(`the label "${name}" in the set "${set.set}" has no description`);
      }
      if (label.target !== undefined && label.target !== 'required') {
        fail(
          `the label "${name}" in the set "${set.set}" has target ${JSON.stringify(label.target)}, only "required" is allowed`,
        );
      }
      if (label.condition !== undefined && label.condition !== true)
        fail(
          `the label "${name}" in the set "${set.set}" has condition ${JSON.stringify(label.condition)}, only true is allowed`,
        );
      if (label.condition === true && label.target !== 'required')
        fail(`the label "${name}" is a condition and needs target: required`);
      if (label.condition === true && label.atom !== undefined)
        fail(`the label "${name}" is a condition and builds no atom of its own: it takes no atom mapping`);
      const def: RefLabel = { name, description: label.description };
      if (label.condition === true) def.condition = true;
      if (Array.isArray(label.examples)) def.examples = label.examples.map(String);
      if (label.target === 'required') def.target = 'required';
      if (label.atom && typeof label.atom === 'object') {
        const atom = label.atom as Record<string, unknown>;
        if (typeof atom.kind !== 'string') fail(`the atom mapping of "${name}" has no kind`);
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
        if (!names) fail(`the label "${name}" has an empty ${field} list`);
        const what = field === 'spans' ? 'span' : 'link';
        for (const kind of names)
          if (!declared.some((k) => k.name === kind))
            fail(`the label ${name} names the ${what} kind ${kind}, which the set does not declare`);
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
