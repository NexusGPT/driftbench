import { foldQuote } from '@agent-nexus/driftbench-generate';
import { type AtomBuilder, namedPaths, pathMentions } from '../scan/code';
import { PROSE_KINDS } from '../scan/prose';
import { type Located, lineAt, quoteAtSpan } from '../scan/text';
import type { Atom } from '../schema';
import type { LabelledUnit } from './scan';

/**
 * Atoms from labels. A label with an `atom` mapping builds an atom of that kind (and polarity) from the unit
 * the labeler pointed at: the quote and the line span are `source.slice` of the file, never words the labeler
 * wrote. The evidence is one `prose_pointer` check that a person must review; the labeler writes none.
 *
 * A label marked `condition` builds no atom. Its unit states when its target unit applies: the text of the unit
 * becomes the `situation` of the atom built from the target (a gate: from its first unit), several conditions
 * of one target joined in file order. The condition's unit ids are kept in the atom's fields and in its check.
 */

export type PointerAtoms = { accepted: Atom[]; refusals: string[]; duplicates: string[] };

/** The atom kinds a label may build: those of prose, and the hazards the prose names. */
export const POINTER_KINDS = [...PROSE_KINDS, 'hazard', 'reference', 'script'] as const;

const TITLE_CHARACTERS = 90;

/** What a template of a mapping can take from the unit: the labeller's links and spans, the unit's own structure. */
type Template = {
  link(kind: string, property?: string): string | undefined;
  span(kind: string): string | undefined;
  /** The texts of every span of this kind, in order, each an exact slice of the file. */
  spans(kind: string): string[];
  code(): string | undefined;
  named(): string | undefined;
  path(): string | undefined;
  unit(): string;
  file(): string;
  /** Whether the labeller gave a span of this kind. */
  hasSpan(kind: string): boolean;
  /** Every file of the estate the unit names, in the order it names them. */
  paths(): string[];
  /** Every inline code span of the unit, in order. */
  codes(): string[];
  /** The inline code spans of the unit that lead to no file of the estate: commands, names, values. */
  commands(): string[];
  /** The item of the list an `each` form is walking, if any. */
  item?: string;
};

const UNRESOLVED = Symbol('unresolved');
const PLACEHOLDER =
  /^\$(?:link\.([a-z][a-z0-9-]*)(?:\.([a-z]+))?|span\.([a-z][a-z0-9-]*)|has\.([a-z][a-z0-9-]*)|spans\.([a-z][a-z0-9-]*)|code|named|path|paths|codes|commands|item|unit|file)$/;

/**
 * Fills the placeholders of a value of a mapping: a string that is exactly `$link.<kind>` (the value the labeller
 * gave a link), `$span.<kind>` (the text of the first span of that kind, an exact slice of the file), `$code` (the
 * first inline code span of the unit) or `$path` (that code span as the file of the estate it leads to). Any other
 * string is kept as it is. A placeholder the unit does not fill makes the whole value unresolved.
 */
function fill(value: unknown, template: Template): unknown {
  if (typeof value === 'string') {
    // `${link.topic.name}` inside a longer string is replaced by its value; an unfilled one leaves it unresolved.
    if (value.includes('${')) {
      let unresolved = false;
      const text = value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
        const found = fill(`$${name}`, template);
        if (found === UNRESOLVED || typeof found !== 'string') unresolved = true;
        return typeof found === 'string' ? found : '';
      });
      return unresolved ? UNRESOLVED : text;
    }
    const match = PLACEHOLDER.exec(value);
    if (!match) return value;
    const found: unknown = match[1]
      ? template.link(match[1], match[2])
      : match[3]
        ? template.span(match[3])
        : match[4]
          ? template.hasSpan(match[4])
            ? true
            : undefined
          : match[5]
            ? nonEmpty(template.spans(match[5]))
            : value === '$code'
              ? template.code()
              : value === '$named'
                ? template.named()
                : value === '$path'
                  ? template.path()
                  : value === '$paths'
                    ? template.paths()
                    : value === '$codes'
                      ? template.codes()
                      : value === '$commands'
                        ? template.commands()
                        : value === '$item'
                          ? template.item
                          : value === '$unit'
                            ? template.unit()
                            : template.file();
    return found === undefined ? UNRESOLVED : found;
  }
  if (Array.isArray(value)) {
    const out = value.map((item) => fill(item, template));
    return out.includes(UNRESOLVED) ? UNRESOLVED : out;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    // `{ each: <list placeholder>, item: <template> }`: one filled item for each member of the list, with `$item`
    // standing for the member; an item that does not fill is left out.
    if (entries.length === 2 && 'each' in value && 'item' in value) {
      const list = fill((value as { each: unknown }).each, template);
      if (!Array.isArray(list)) return UNRESOLVED;
      return list
        .map((member) => fill((value as { item: unknown }).item, { ...template, item: String(member) }))
        .filter((filled) => filled !== UNRESOLVED);
    }
    // `{ firstFilled: [a, b] }`: the first alternative whose placeholders are all filled.
    if (entries.length === 1 && Array.isArray((value as { firstFilled?: unknown }).firstFilled)) {
      for (const alternative of (value as { firstFilled: unknown[] }).firstFilled) {
        const filled = fill(alternative, template);
        if (filled !== UNRESOLVED) return filled;
      }
      return UNRESOLVED;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      const filled = fill(item, template);
      // A key that ends in `?` is optional: it is left out, without its mark, when its value does not fill.
      if (key.endsWith('?')) {
        if (filled !== UNRESOLVED) out[key.slice(0, -1)] = filled;
        continue;
      }
      if (filled === UNRESOLVED) return UNRESOLVED;
      out[key] = filled;
    }
    return out;
  }
  return value;
}

/** A list placeholder that found nothing does not fill: `$spans.<kind>` with no span of that kind. */
const nonEmpty = (list: string[]): string[] | undefined => (list.length > 0 ? list : undefined);

/** The text between the first pair of backticks of a unit: a code span, by Markdown structure. */
const codeSpanOf = (text: string): string | undefined => /`([^`\n]+)`/.exec(text)?.[1]?.trim() || undefined;

/** The first path a unit names, by the written forms of a name (code span, link, quoted, wiki), else its first code span. */
const namedOf = (text: string): string | undefined => namedPaths(text)[0] ?? codeSpanOf(text);

function titleOf(text: string): string {
  const flat = text
    .replace(/[*`]/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)]|#+|>)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= TITLE_CHARACTERS ? flat : `${flat.slice(0, TITLE_CHARACTERS - 1).trimEnd()}…`;
}

/** The limits a unit's numeric links state: the number, how a quantity is compared with it, and what it counts. */
function limitsOf(item: LabelledUnit): Array<{ limit: number; comparison: string; unit?: string }> {
  return (item.links ?? []).flatMap((link) =>
    link.to !== 'none' &&
    typeof link.value === 'number' &&
    item.set.links?.find((kind) => kind.name === link.kind)?.number
      ? [{ limit: link.value, comparison: link.to, ...(link.unit === undefined ? {} : { unit: link.unit }) }]
      : [],
  );
}

export function pointerAtoms(
  labelled: readonly LabelledUnit[],
  texts: ReadonlyMap<string, string>,
  builder: AtomBuilder,
  labeler: string,
): PointerAtoms {
  const accepted: Atom[] = [];
  const refusals: string[] = [];
  const duplicates: string[] = [];
  const conditions = new Map<string, LabelledUnit[]>();
  for (const item of labelled) {
    if (!item.set.labels.find((label) => label.name === item.label)?.condition || !item.target) continue;
    const key = `${item.set.set}:${item.target.id}`;
    conditions.set(key, [...(conditions.get(key) ?? []), item]);
  }
  // A bound unit (a condition label with numeric links) gives its limits to the atoms of the unit it points at, in
  // whichever set that unit is labelled: a set of limits can sit beside the set of rules.
  const boundFor = new Map<string, LabelledUnit[]>();
  for (const item of labelled) {
    if (!item.set.labels.find((label) => label.name === item.label)?.condition || !item.target) continue;
    if (limitsOf(item).length === 0) continue;
    boundFor.set(item.target.id, [...(boundFor.get(item.target.id) ?? []), item]);
  }
  const attached = new Set<string>();
  for (const item of labelled) {
    const label = item.set.labels.find((candidate) => candidate.name === item.label);
    const primary = label?.atom;
    if (!primary) continue;
    const where = `${item.path} unit ${item.id} (${item.label})`;
    const text = texts.get(item.path);
    if (text === undefined) continue;
    // A gate holds two units: the quote runs from the first to the end of the second, in file order.
    const spans = [item.unit, ...(item.target ? [item.target.unit] : [])];
    const start = Math.min(...spans.map((unit) => unit.start));
    const end = Math.max(...spans.map((unit) => unit.end));
    const at: Located = {
      file: item.path,
      startLine: lineAt(text, start),
      endLine: lineAt(text, end),
      quote: text.slice(start, end),
    };
    if (!quoteAtSpan(text, at)) {
      refusals.push(`${where}: the unit is not at lines ${at.startLine} to ${at.endLine} of the file`);
      continue;
    }
    const folded = foldQuote(at.quote);
    const conditional = (conditions.get(`${item.set.set}:${item.id}`) ?? []).sort(
      (a, b) => a.unit.start - b.unit.start,
    );
    const conditionIds = conditional.map((condition) => condition.id);
    // Spans are offsets into the unit; the atom keeps them as offsets into its own quote, each an exact slice
    // of the file. A span that is not one is dropped with its reason; the atom keeps its label.
    const labelSpans: Array<{ kind: string; from: number; to: number; polarity?: string }> = [];
    for (const span of item.spans ?? []) {
      const here = text.slice(item.unit.start + span.from, item.unit.start + span.to);
      if (here === '' || here !== item.unit.text.slice(span.from, span.to)) {
        refusals.push(
          `${where}: the ${span.kind} span ${span.from} to ${span.to} is not an exact slice of the file`,
        );
        continue;
      }
      labelSpans.push({
        ...span,
        from: item.unit.start - start + span.from,
        to: item.unit.start - start + span.to,
      });
    }
    // A link names an atom of the estate (one the scan does not hold is dropped with its reason), or a value of
    // a closed list the set declares.
    const labelLinks: Array<{ kind: string; atom?: string; value?: string }> = [];
    // A link of a numeric kind is a limit of the unit: the number, how a quantity is compared with it, and what it
    // counts. The atoms of the unit take them in `fields.condition`, which the variable feed reads and nothing else.
    const bound = boundFor.get(item.id) ?? [];
    const limits = [...limitsOf(item), ...bound.flatMap(limitsOf)];
    for (const link of item.links ?? []) {
      if (link.to === 'none') continue;
      if (item.set.links?.find((kind) => kind.name === link.kind)?.number) continue;
      if (item.set.links?.find((kind) => kind.name === link.kind)?.values) {
        labelLinks.push({ kind: link.kind, value: link.to });
        continue;
      }
      if (!builder.atoms.some((other) => other.id === link.to)) {
        refusals.push(`${where}: the ${link.kind} link names ${link.to}, which is no atom of the estate`);
        continue;
      }
      labelLinks.push({ kind: link.kind, atom: link.to });
    }
    // A unit that names no file of its own and has a target unit (an act asked in one unit, the file to read first
    // given in the next) takes the paths of its target. A file is a path by structure (a slash, an extension, a link):
    // a code span that is no path, such as a tool name, is not a file and does not block this.
    const holder =
      item.target !== undefined && namedPaths(item.unit.text).length === 0
        ? item.target.unit.text
        : item.unit.text;
    const code = codeSpanOf(holder);
    // A line of a standing file that is `@path` is an import: the runtime loads it and the agent reads nothing.
    const imported = (path: string): boolean =>
      builder.kindOf(item.path) === 'standing' &&
      holder.split('\n').some((line) => line.trim() === `@${path}`);
    const bareNames = new Set(
      pathMentions(holder)
        .filter((reference) => reference.bare)
        .map((reference) => reference.path),
    );
    const allNamed = namedPaths(holder).filter((path) => !imported(path));
    const firstNamed = namedOf(holder);
    const readable = allNamed.length > 0 ? allNamed[0] : imported(firstNamed ?? '') ? undefined : firstNamed;
    const templateFor = (namedPath: string | undefined, chosen?: (typeof labelLinks)[number]): Template => ({
      link: (kind, property) => {
        const found = chosen?.kind === kind ? chosen : labelLinks.find((link) => link.kind === kind);
        if (found?.value !== undefined) return property === undefined ? found.value : undefined;
        if (found?.atom === undefined) return undefined;
        if (property === undefined || property === 'id') return found.atom;
        const target = builder.atoms.find((other) => other.id === found.atom);
        if (property === 'kind') return target?.kind;
        const field = target?.fields?.[property];
        return typeof field === 'string' ? field : undefined;
      },
      span: (kind) => {
        const span = labelSpans.find((entry) => entry.kind === kind);
        return span ? text.slice(start + span.from, start + span.to) : undefined;
      },
      spans: (kind) =>
        labelSpans
          .filter((entry) => entry.kind === kind)
          .map((entry) => text.slice(start + entry.from, start + entry.to)),
      code: () => code,
      named: () => namedPath,
      path: () => (namedPath === undefined ? undefined : builder.locate(namedPath, item.path)),
      unit: () => item.unit.text,
      file: () => item.path,
      hasSpan: (kind) => labelSpans.some((entry) => entry.kind === kind),
      paths: () => [
        ...new Set(
          allNamed
            .map((named) => builder.locate(named, item.path))
            .filter((located): located is string => located !== undefined),
        ),
      ],
      commands: () =>
        [...item.unit.text.matchAll(/`([^`\n]+)`/g)]
          .map((m) => m[1]?.trim() ?? '')
          .filter((span) => span !== '' && !builder.resolve(span, item.path).exists),
      codes: () =>
        [...item.unit.text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]?.trim() ?? '').filter(Boolean),
    });
    let kept = false;
    for (const mapping of [primary, ...(primary.also ?? [])]) {
      const paths =
        (mapping.locate === 'each' || mapping.whenFile === 'each') && allNamed.length > 0
          ? allNamed
          : [readable];
      // A unit that links several atoms by the kind of link its mapping names (a routing row naming two skills)
      // gives one atom for each of them: the links of that kind are read in turn, each in its own atom.
      const kinds = new Set([...JSON.stringify(mapping).matchAll(/\$\{?link\.([\w-]+)/g)].map((m) => m[1]));
      const repeated = [...kinds].find(
        (kind) => labelLinks.filter((link) => link.kind === kind && link.atom !== undefined).length > 1,
      );
      const choices: Array<(typeof labelLinks)[number] | undefined> =
        repeated === undefined
          ? [undefined]
          : labelLinks.filter((link) => link.kind === repeated && link.atom !== undefined);
      const pairs = paths.flatMap((path) => choices.map((link) => [path, link] as const));
      for (const [namedPath, chosen] of pairs) {
        const template = templateFor(namedPath, chosen);
        // An atom built for one of several links of a kind keeps that link alone of its kind.
        const ownLinks = labelLinks.filter((link) => !chosen || link.kind !== chosen.kind || link === chosen);
        if (!(POINTER_KINDS as readonly string[]).includes(mapping.kind)) {
          refusals.push(
            `${where}: the label ${item.label} maps to the atom kind ${mapping.kind}, which a pointer cannot build`,
          );
          continue;
        }
        const same = builder.atoms.find(
          (other) =>
            other.kind === mapping.kind &&
            other.provenance.file === at.file &&
            other.provenance.startLine <= at.endLine &&
            at.startLine <= other.provenance.endLine &&
            other.fields?.unit !== item.id &&
            (other.producedBy === 'code' || foldQuote(other.provenance.quote) === folded),
        );
        if (same) {
          duplicates.push(`${where} repeats ${same.id}`);
          continue;
        }
        // A situation written `<placeholder>?` is optional: the atom is kept, without one, when it does not fill.
        const optionalSituation = mapping.situation?.endsWith('?') === true;
        const filledSituation =
          mapping.situation === undefined
            ? undefined
            : fill(optionalSituation ? mapping.situation.slice(0, -1) : mapping.situation, template);
        const situation = optionalSituation && filledSituation === UNRESOLVED ? undefined : filledSituation;
        const title = mapping.title === undefined ? undefined : fill(mapping.title, template);
        const mappedReplyAct = mapping.replyAct === undefined ? undefined : fill(mapping.replyAct, template);
        let mappedFields = mapping.fields === undefined ? {} : fill(mapping.fields, template);
        // A declared ask names the act it exercises: the reply act of its own atom, typed by the map and read from
        // no word. An ask on an atom without a reply act carries none, so the generator refuses it.
        if (
          mappedFields !== UNRESOLVED &&
          mappedReplyAct !== undefined &&
          mappedReplyAct !== UNRESOLVED &&
          typeof (mappedFields as Record<string, unknown>).ask === 'object' &&
          (mappedFields as Record<string, unknown>).ask !== null
        ) {
          const ask = (mappedFields as { ask: Record<string, unknown> }).ask;
          mappedFields = {
            ...(mappedFields as Record<string, unknown>),
            ask: { ...ask, act: { kind: 'reply', name: (mappedReplyAct as { id: string }).id } },
          };
        }
        const mappedEvidence = mapping.evidence === undefined ? [] : fill(mapping.evidence, template);
        // A mapping that locates its code span as a file resolves it by the estate's own places, never by words.
        let located: Record<string, unknown> = {};
        if (mapping.whenFile && (namedPath === undefined || !builder.resolve(namedPath, item.path).exists))
          continue;
        if (mapping.locate || mapping.whenFile) {
          if (namedPath === undefined) {
            refusals.push(`${where}: the label ${item.label} locates a file, and the unit names none`);
            continue;
          }
          const target = builder.resolve(namedPath, item.path, bareNames.has(namedPath));
          located = {
            path: target.path,
            ...(target.unresolved ? { written: namedPath, unresolved: true } : {}),
            ...(target.concrete ? { concrete: true } : {}),
            exists: target.exists,
            ...(target.ignored ? { ignored: true } : {}),
            ...(target.via === 'alias' || target.via === 'suffix' ? { resolvedBy: target.via } : {}),
            ...(target.candidates ? { candidates: target.candidates } : {}),
            ...(target.via === 'external' ? { external: true } : {}),
          };
        }
        if (
          situation === UNRESOLVED ||
          title === UNRESOLVED ||
          mappedFields === UNRESOLVED ||
          mappedEvidence === UNRESOLVED
        ) {
          refusals.push(
            `${where}: the label ${item.label} needs a span, a link or a code span that the unit does not give`,
          );
          continue;
        }
        kept = true;
        accepted.push(
          builder.add({
            kind: mapping.kind as (typeof POINTER_KINDS)[number],
            title: typeof title === 'string' ? title : titleOf(item.unit.text),
            at,
            ...(conditional.length > 0
              ? { situation: conditional.map((condition) => condition.unit.text.trim()).join(' ') }
              : typeof situation === 'string'
                ? { situation }
                : {}),
            evidence: [
              {
                type: 'custom',
                name: 'prose_pointer',
                options: {
                  reviewRequired: true,
                  unit: item.id,
                  set: item.set.set,
                  label: item.label,
                  ...(conditionIds.length > 0 ? { condition: conditionIds } : {}),
                },
              },
              ...(mappedEvidence as NonNullable<typeof mapping.evidence>),
            ],
            producedBy: 'model',
            ...(mappedReplyAct !== undefined && mappedReplyAct !== UNRESOLVED
              ? { replyAct: mappedReplyAct as NonNullable<Atom['replyAct']> }
              : {}),
            fields: {
              ...located,
              ...(mappedFields as Record<string, unknown>),
              extraction: 'pointer',
              unit: item.id,
              labelSet: item.set.set,
              label: item.label,
              labeler,
              ...(conditionIds.length > 0 || limits.length > 0
                ? { condition: [...conditionIds, ...limits] }
                : {}),
              ...(mapping.polarity ? { polarity: mapping.polarity } : {}),
              ...(labelSpans.length > 0 ? { labelSpans } : {}),
              ...(ownLinks.length > 0 ? { labelLinks: ownLinks } : {}),
            },
          }),
        );
      }
    }
    if (kept) {
      for (const condition of conditional) attached.add(`${condition.set.set}:${condition.id}`);
      for (const condition of bound) attached.add(`${condition.set.set}:${condition.id}`);
    }
  }
  for (const items of conditions.values()) {
    for (const condition of items) {
      if (attached.has(`${condition.set.set}:${condition.id}`)) continue;
      refusals.push(
        `${condition.path} unit ${condition.id} (${condition.label}): the condition points at a unit that holds no atom`,
      );
    }
  }
  return { accepted, refusals, duplicates };
}
