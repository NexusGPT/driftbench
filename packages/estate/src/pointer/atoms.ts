import { foldQuote } from '@agent-nexus/driftbench-generate';
import type { AtomBuilder } from '../scan/code';
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
  code(): string | undefined;
  path(): string | undefined;
  unit(): string;
  file(): string;
};

const UNRESOLVED = Symbol('unresolved');
const PLACEHOLDER =
  /^\$(?:link\.([a-z][a-z0-9-]*)(?:\.([a-z]+))?|span\.([a-z][a-z0-9-]*)|code|path|unit|file)$/;

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
    const found = match[1]
      ? template.link(match[1], match[2])
      : match[3]
        ? template.span(match[3])
        : value === '$code'
          ? template.code()
          : value === '$path'
            ? template.path()
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
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const filled = fill(item, template);
      if (filled === UNRESOLVED) return UNRESOLVED;
      out[key] = filled;
    }
    return out;
  }
  return value;
}

/** The text between the first pair of backticks of a unit: a code span, by Markdown structure. */
const codeSpanOf = (text: string): string | undefined => /`([^`\n]+)`/.exec(text)?.[1]?.trim() || undefined;

function titleOf(text: string): string {
  const flat = text
    .replace(/[*`]/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)]|#+|>)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= TITLE_CHARACTERS ? flat : `${flat.slice(0, TITLE_CHARACTERS - 1).trimEnd()}…`;
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
  const attached = new Set<string>();
  for (const item of labelled) {
    const label = item.set.labels.find((candidate) => candidate.name === item.label);
    const primary = label?.atom;
    if (!primary) continue;
    const named = `${item.path} unit ${item.id} (${item.label})`;
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
      refusals.push(`${named}: the unit is not at lines ${at.startLine} to ${at.endLine} of the file`);
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
          `${named}: the ${span.kind} span ${span.from} to ${span.to} is not an exact slice of the file`,
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
    for (const link of item.links ?? []) {
      if (link.to === 'none') continue;
      if (item.set.links?.find((kind) => kind.name === link.kind)?.values) {
        labelLinks.push({ kind: link.kind, value: link.to });
        continue;
      }
      if (!builder.atoms.some((other) => other.id === link.to)) {
        refusals.push(`${named}: the ${link.kind} link names ${link.to}, which is no atom of the estate`);
        continue;
      }
      labelLinks.push({ kind: link.kind, atom: link.to });
    }
    const code = codeSpanOf(item.unit.text);
    const template: Template = {
      link: (kind, property) => {
        const found = labelLinks.find((link) => link.kind === kind);
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
      code: () => code,
      path: () => (code === undefined ? undefined : builder.locate(code, item.path)),
      unit: () => item.unit.text,
      file: () => item.path,
    };
    let kept = false;
    for (const mapping of [primary, ...(primary.also ?? [])]) {
      if (!(POINTER_KINDS as readonly string[]).includes(mapping.kind)) {
        refusals.push(
          `${named}: the label ${item.label} maps to the atom kind ${mapping.kind}, which a pointer cannot build`,
        );
        continue;
      }
      const same = builder.atoms.find(
        (other) =>
          other.kind === mapping.kind &&
          other.provenance.file === at.file &&
          other.provenance.startLine <= at.endLine &&
          at.startLine <= other.provenance.endLine &&
          (other.producedBy === 'code' || foldQuote(other.provenance.quote) === folded),
      );
      if (same) {
        duplicates.push(`${named} repeats ${same.id}`);
        continue;
      }
      const situation = mapping.situation === undefined ? undefined : fill(mapping.situation, template);
      const title = mapping.title === undefined ? undefined : fill(mapping.title, template);
      const mappedFields = mapping.fields === undefined ? {} : fill(mapping.fields, template);
      const mappedEvidence = mapping.evidence === undefined ? [] : fill(mapping.evidence, template);
      // A mapping that locates its code span as a file resolves it by the estate's own places, never by words.
      let located: Record<string, unknown> = {};
      if (mapping.whenFile && (code === undefined || !builder.resolve(code, item.path).exists)) continue;
      if (mapping.locate || mapping.whenFile) {
        if (code === undefined) {
          refusals.push(`${named}: the label ${item.label} locates a file, and the unit has no code span`);
          continue;
        }
        const target = builder.resolve(code, item.path);
        located = {
          path: target.path,
          exists: target.exists,
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
          `${named}: the label ${item.label} needs a span, a link or a code span that the unit does not give`,
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
          fields: {
            ...located,
            ...(mappedFields as Record<string, unknown>),
            extraction: 'pointer',
            unit: item.id,
            labelSet: item.set.set,
            label: item.label,
            cassette: item.source,
            labeler,
            ...(conditionIds.length > 0 ? { condition: conditionIds } : {}),
            ...(mapping.polarity ? { polarity: mapping.polarity } : {}),
            ...(labelSpans.length > 0 ? { labelSpans } : {}),
            ...(labelLinks.length > 0 ? { labelLinks } : {}),
          },
        }),
      );
    }
    if (kept) for (const condition of conditional) attached.add(`${condition.set.set}:${condition.id}`);
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
