import templates from './ask-templates.json';

/**
 * The validator's own construction of an ask that code wrote (docs/estate.md section 5, "The ask templates"), kept
 * apart from the product: `gen.asks` never judges `codeAsk` with `codeAsk`. Nothing here reads the words of an ask
 * or searches the templates for one that fits. The generated spec records how it built each ask
 * (`metadata.estate.askBuild`, one entry per block): the rows of the table it used and, for each `{span}`, the map
 * atom, the field and the offsets the words were cut from. The validator checks that record against the plan row
 * and the map, builds the ONE ask it describes from the map's own text, and requires byte equality with the ask the
 * spec carries. A missing, forged or mismatched record fails. The table is held in `ask-templates.json`, and a test
 * fails when the file differs from the table of the document.
 */

type Part = { lit: string } | { slot: string } | { opt: Part[] };
type Entry = { kind: string; template: string; tools?: readonly string[] };

export const ASK_TEMPLATES: readonly Entry[] = templates;

/** A template as literals, slots and optional groups (`[...]`). */
function parse(template: string): Part[] {
  const stack: Part[][] = [[]];
  let lit = '';
  const flush = () => {
    if (lit !== '') (stack.at(-1) as Part[]).push({ lit });
    lit = '';
  };
  for (let i = 0; i < template.length; i++) {
    const c = template[i] as string;
    if (c === '{') {
      flush();
      const end = template.indexOf('}', i);
      (stack.at(-1) as Part[]).push({ slot: template.slice(i + 1, end) });
      i = end;
    } else if (c === '[') {
      flush();
      stack.push([]);
    } else if (c === ']') {
      flush();
      const opt = stack.pop() as Part[];
      (stack.at(-1) as Part[]).push({ opt });
    } else lit += c;
  }
  flush();
  return stack[0] as Part[];
}

/** Where a `{span}` was cut from: the atom, the field (a dot path in the atom) and the offsets into its text. */
export type SpanSource = {
  slot: 'ask' | 'act' | 'situation';
  atom: string;
  field: string;
  from: number;
  to: number;
};

/** How the generator built one ask: the rows of the table it used and the sources of its spans. */
export type AskBuild = {
  ask: string;
  act?: string;
  situation?: string;
  spans: SpanSource[];
  /** For an act that stands for a tool: the guard that watches the tool, and the tool. */
  tool?: { atom: string; name: string };
};

export type MapAtom = {
  id: string;
  kind: string;
  title?: string;
  situation?: string;
  fields?: unknown;
  provenance?: { quote?: string };
};

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * The act text an atom declares, by the field a span cites; undefined for any other field. Only the declared act
 * may give words to an ask: `fields.ask` (a route's request cell), `fields.ask.text` and `fields.ask.context`, and
 * `governed-action`, the quote of the atom's unit, whose labelled governed-action spans bound the cut; and the
 * atom's verbatim source text, `provenance.quote`, its `situation` or the trigger cut from it (`fields.trigger`).
 * Metadata (`id`, `kind`), a title or a description never does.
 */
// `whole`: the text is the atom's verbatim source (its quote or trigger), taken whole, never sliced.
type Declared = { text: string; within?: Array<[number, number]>; whole?: boolean };

function declaredText(atom: MapAtom, field: string): Declared | undefined {
  const fields = (atom.fields ?? {}) as { ask?: unknown; labelSpans?: unknown; trigger?: unknown };
  const ask = fields.ask;
  // The atom's verbatim source text: the quote of its unit, or the trigger the scan cut from it.
  const quoted = (atom as { provenance?: { quote?: unknown } }).provenance?.quote;
  if (field === 'provenance.quote')
    return typeof quoted === 'string' ? { text: quoted, whole: true } : undefined;
  if (field === 'situation') return typeof atom.situation === 'string' ? { text: atom.situation } : undefined;
  if (field === 'fields.trigger')
    return typeof fields.trigger === 'string' ? { text: fields.trigger, whole: true } : undefined;
  type Ask = { text?: unknown; context?: unknown };
  const declared: Ask = ask !== null && typeof ask === 'object' ? (ask as Ask) : {};
  const value =
    field === 'fields.ask'
      ? ask
      : field === 'fields.ask.text'
        ? declared.text
        : field === 'fields.ask.context'
          ? declared.context
          : undefined;
  if (field !== 'governed-action') return typeof value === 'string' ? { text: value } : undefined;
  const quote = (atom as { provenance?: { quote?: unknown } }).provenance?.quote;
  const spans = (Array.isArray(fields.labelSpans) ? fields.labelSpans : []) as Array<{
    kind?: unknown;
    from?: unknown;
    to?: unknown;
  }>;
  const within = spans
    .filter((span) => span.kind === 'governed-action')
    .map((span) => [Number(span.from), Number(span.to)] as [number, number]);
  return typeof quote === 'string' && within.length > 0 ? { text: quote, within } : undefined;
}

const rowOf = (kind: string | readonly string[], template: string | undefined): Entry | undefined =>
  template === undefined
    ? undefined
    : ASK_TEMPLATES.find(
        (entry) =>
          (typeof kind === 'string' ? entry.kind === kind : kind.includes(entry.kind)) &&
          entry.template === template,
      );

/**
 * The one ask a construction record describes, built from the map, or the reason the record is refused. `allowed`
 * holds the atoms the row may take words from: its own atoms and the atoms their fields name.
 */
export function constructAsk(
  build: unknown,
  atoms: ReadonlyMap<string, MapAtom>,
  allowed: ReadonlySet<string>,
): { text: string } | { refused: string } {
  if (build === null || typeof build !== 'object') return { refused: 'no construction record' };
  const record = build as Partial<AskBuild>;
  // Every field of the record is consumed by the construction: an unknown one is refused, and so is a field the
  // construction never reads (an act for an ask row with no {act}, a tool for an act that is no fixed act).
  const known = ['ask', 'act', 'situation', 'spans', 'tool'];
  const extra = Object.keys(record).find((key) => !known.includes(key));
  if (extra) return { refused: `the record holds a field no construction reads: ${extra}` };
  let actUsed = false;
  let situationUsed = false;
  let toolUsed = false;
  const ask = rowOf(['ask', 'fixed'], record.ask);
  if (!ask) return { refused: `the ask row ${JSON.stringify(record.ask)} is not a row of the table` };
  const act = record.act === undefined ? undefined : rowOf('act', record.act);
  if (record.act !== undefined && !act)
    return { refused: `the act row ${JSON.stringify(record.act)} is not a row of the table` };
  const situation = record.situation === undefined ? undefined : rowOf('situation', record.situation);
  if (record.situation !== undefined && !situation)
    return { refused: `the situation row ${JSON.stringify(record.situation)} is not a row of the table` };
  const spans = Array.isArray(record.spans) ? record.spans : [];
  const queue: Record<string, SpanSource[]> = { ask: [], act: [], situation: [] };
  for (const span of spans) {
    if (!span || !(span.slot in queue)) return { refused: 'a span names no slot of ask, act or situation' };
    (queue[span.slot] as SpanSource[]).push(span);
  }
  const cut = (slot: string): { text: string } | { refused: string } => {
    const span = queue[slot]?.shift();
    if (!span) return { refused: `no span recorded for a {span} of the ${slot} row` };
    if (!allowed.has(span.atom)) return { refused: `the span's atom ${span.atom} is not an atom of the row` };
    const atom = atoms.get(span.atom);
    const declared = atom ? declaredText(atom, span.field) : undefined;
    if (declared === undefined)
      return { refused: `the map atom ${span.atom} declares no act text at ${span.field}` };
    const value = declared.text;
    const { from, to } = span;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > value.length || from >= to)
      return { refused: `the offsets ${from}-${to} are outside ${span.atom} ${span.field}` };
    if (declared.whole && (from !== 0 || to !== value.length))
      return { refused: `the span of ${span.atom} ${span.field} is a slice; the source text is taken whole` };
    if (declared.within && !declared.within.some(([start, end]) => start <= from && to <= end))
      return { refused: `the span of ${span.atom} lies outside its labelled governed action` };
    const slice = value.slice(from, to);
    // A span holds a word and no space at its ends: whitespace or punctuation alone is no act.
    if (!/[\p{L}\p{N}]/u.test(slice) || slice.trim() !== slice)
      return { refused: `the span "${slice}" of ${span.atom} holds no word or starts or ends on a space` };
    // A span is a run of whole words: it starts and ends at the edge of a word of the field.
    if (isWordChar(value[from - 1]) && isWordChar(value[from]))
      return { refused: `the span of ${span.atom} ${span.field} starts inside a word` };
    if (isWordChar(value[to - 1]) && isWordChar(value[to]))
      return { refused: `the span of ${span.atom} ${span.field} ends inside a word` };
    return { text: value.slice(from, to) };
  };
  let refusal: string | undefined;
  const render = (parts: Part[], slot: 'ask' | 'act' | 'situation'): string => {
    let out = '';
    for (const part of parts) {
      if (refusal !== undefined) return '';
      if ('lit' in part) out += part.lit;
      else if ('opt' in part) {
        // The optional group is written exactly when the record names a situation for it.
        const wants = part.opt.some((inner) => 'slot' in inner && inner.slot === 'situation');
        if (wants && situation !== undefined) out += render(part.opt, slot);
      } else if (part.slot === 'act') {
        if (!act) {
          refusal = 'the ask row has an {act} and the record names no act row';
          return '';
        }
        actUsed = true;
        const inner = parse(act.template);
        // A bare `{span}` act is a task of at least three words, the floor of section 5.
        const text = render(inner, 'act');
        if (inner.length === 1 && 'slot' in (inner[0] as Part) && text.trim().split(/\s+/).length < 3)
          refusal = `the bare act "${text}" has fewer than three words`;
        out += text;
      } else if (part.slot === 'situation') {
        if (!situation) {
          refusal = 'the situation group is written and the record names no situation row';
          return '';
        }
        situationUsed = true;
        out += render(parse(situation.template), 'situation');
      } else if (part.slot === 'tool') {
        // `{tool}`: a tool name of the guard's matcher, the tool the record names.
        if (!record.tool) {
          refusal = 'the ask row has a {tool} and the record names no tool';
          return '';
        }
        toolUsed = true;
        out += record.tool.name;
      } else if (part.slot === 'span' || part.slot === 'message') {
        const got = cut(slot);
        if ('refused' in got) {
          refusal = got.refused;
          return '';
        }
        out += got.text;
      } else {
        refusal = `the slot {${part.slot}} is not a slot of section 5`;
        return '';
      }
    }
    return out;
  };
  const text = render(parse(ask.template), 'ask');
  if (refusal !== undefined) return { refused: refusal };
  if (record.act !== undefined && !actUsed)
    return { refused: 'the record names an act row the ask row never uses' };
  if (record.situation !== undefined && !situationUsed)
    return { refused: 'the record names a situation row the ask row never uses' };
  // The Tools column ties an act to the tools that carry it out. A fixed act with tools needs the record's tool, one
  // of them; an act with no tools takes none. A tool is consumed by a {tool} slot or by an act row that lists it.
  const tied = act?.tools !== undefined;
  const fixedAct = act !== undefined && !parse(act.template).some((part) => 'slot' in part);
  if (fixedAct && tied && record.tool === undefined)
    return { refused: `the fixed act "${act?.template}" names no tool` };
  if (record.tool !== undefined && !toolUsed && !tied)
    return { refused: 'the record names a tool that neither its ask row nor its act row uses' };
  if (record.tool !== undefined) {
    const tool = record.tool;
    if (tied && !act?.tools?.includes(tool.name))
      return { refused: `the table does not tie "${act?.template}" to ${tool.name}` };
    if (!allowed.has(tool.atom)) return { refused: `the guard ${tool.atom} is not an atom of the row` };
    const matcher = (atoms.get(tool.atom)?.fields as { matcher?: unknown } | undefined)?.matcher;
    const watches = typeof matcher === 'string' && matcher.split('|').includes(tool.name);
    if (atoms.get(tool.atom)?.kind !== 'guard' || !watches)
      return { refused: `the atom ${tool.atom} is no guard that watches ${tool.name}` };
  }
  const left = Object.entries(queue).find(([, list]) => list.length > 0);
  if (left) return { refused: `a span of the ${left[0]} row is recorded and never used` };
  return { text };
}
