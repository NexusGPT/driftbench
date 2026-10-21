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

/** A kind of link a set declares: to atoms of the kinds `to`, or to a closed list of `values`. */
export type LinkKindDef = { name: string; description: string; to?: string[]; values?: string[] };

/** What a mapping adds to its kind and polarity: a title and a situation (templates), and `whenFile`. */
export type MappingExtra = { title?: string; situation?: string; whenFile?: true };

export type ParsedSet = LabelSetDef & {
  hash: string;
  /** The link kinds of the set; empty when it declares none. */
  links: LinkKindDef[];
  /** The link kinds each label may carry, by label name. */
  labelLinks: Map<string, string[]>;
  /** The title, situation and `whenFile` of each label's atom mapping, by label name. */
  mappings: Map<string, MappingExtra>;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;

function linkKindsOf(set: Record<string, unknown>): LinkKindDef[] {
  if (set.links === undefined) return [];
  if (!Array.isArray(set.links) || set.links.length === 0) fail(`the set "${set.set}" has an empty links list`);
  const kinds: LinkKindDef[] = [];
  for (const raw of set.links as unknown[]) {
    const kind = (raw ?? {}) as Record<string, unknown>;
    if (typeof kind.name !== 'string' || !NAME.test(kind.name))
      fail(`a link kind of the set "${set.set}" has no lower-case name`);
    if (typeof kind.description !== 'string' || kind.description.trim() === '')
      fail(`the link kind "${kind.name}" in the set "${set.set}" has no description`);
    const to = strings(kind.to);
    const values = strings(kind.values);
    if ((to === undefined) === (values === undefined))
      fail(`the link kind "${kind.name}" names \`to\` (atom kinds) or \`values\` (a closed list), one of the two`);
    if (kinds.some((other) => other.name === kind.name))
      fail(`the link kind "${kind.name}" is repeated in the set "${set.set}"`);
    kinds.push({
      name: kind.name,
      description: kind.description,
      ...(to ? { to } : {}),
      ...(values ? { values } : {}),
    });
  }
  return kinds;
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
    const seen = new Set<string>();
    const labels: LabelDef[] = [];
    const links = linkKindsOf(set);
    const labelLinks = new Map<string, string[]>();
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
      const def: LabelDef = { name, description: label.description };
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
          ...(typeof atom.situation === 'string' && atom.situation !== '' ? { situation: atom.situation } : {}),
          ...(atom.whenFile === true ? { whenFile: true as const } : {}),
        };
        if (Object.keys(extra).length > 0) mappings.set(name, extra);
      }
      if (label.links !== undefined) {
        const kinds = strings(label.links);
        if (!kinds) fail(`the label "${name}" in the set "${set.set}" has an empty links list`);
        for (const kind of kinds)
          if (!links.some((declared) => declared.name === kind))
            fail(`the label "${name}" names the link kind "${kind}", which the set "${set.set}" does not declare`);
        labelLinks.set(name, kinds);
      }
      labels.push(def);
    }
    const parsed: LabelSetDef = {
      set: set.set,
      description: typeof set.description === 'string' ? set.description : '',
      labels,
    };
    // The set hash covers what the set declares: link kinds and mapping templates join it when the set has any.
    const declared = {
      ...parsed,
      ...(links.length > 0 ? { links, labelLinks: Object.fromEntries(labelLinks) } : {}),
      ...(mappings.size > 0 ? { mappings: Object.fromEntries(mappings) } : {}),
    };
    out.push({
      ...parsed,
      hash: sha256(canonicalCompact(declared)).slice(0, 16),
      links,
      labelLinks,
      mappings,
    });
  }
  return out;
}
