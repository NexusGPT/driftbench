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

export type MapAtom = { id: string; kind: string; title?: string; situation?: string; fields?: unknown };

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The string at a dot path of an atom (`title`, `situation`, `fields.readWhen`, `fields.ask.text`). */
function fieldOf(atom: MapAtom, path: string): string | undefined {
  let value: unknown = atom;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? value : undefined;
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
    const value = atom ? fieldOf(atom, span.field) : undefined;
    if (value === undefined) return { refused: `the map atom ${span.atom} holds no text at ${span.field}` };
    const { from, to } = span;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > value.length || from >= to)
      return { refused: `the offsets ${from}-${to} are outside ${span.atom} ${span.field}` };
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
        if (wants ? situation !== undefined : false) out += render(part.opt, slot);
      } else if (part.slot === 'act') {
        if (!act) {
          refusal = 'the ask row has an {act} and the record names no act row';
          return '';
        }
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
        out += render(parse(situation.template), 'situation');
      } else if (part.slot === 'span') {
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
  if (act && !parse(act.template).some((part) => 'slot' in part)) {
    // A fixed act stands for a tool: the record names the guard and the tool, and the table names the tools of
    // the act. A table row with no tools ties the act to nothing, so no record can use it.
    const tool = record.tool;
    if (!tool) return { refused: `the fixed act "${act.template}" names no tool` };
    if (!act.tools?.includes(tool.name))
      return { refused: `the table does not tie "${act.template}" to ${tool.name}` };
    if (!allowed.has(tool.atom)) return { refused: `the guard ${tool.atom} is not an atom of the row` };
    const matcher = fieldOf(atoms.get(tool.atom) ?? { id: '', kind: '' }, 'fields.matcher');
    if (atoms.get(tool.atom)?.kind !== 'guard' || !(matcher ?? '').split('|').includes(tool.name))
      return { refused: `the atom ${tool.atom} is no guard that watches ${tool.name}` };
  }
  const left = Object.entries(queue).find(([, list]) => list.length > 0);
  if (left) return { refused: `a span of the ${left[0]} row is recorded and never used` };
  return { text };
}
