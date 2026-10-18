import {
  ModelError,
  type ModelPort,
  type ModelRequest,
  type Section,
  sectionOf,
} from '@agent-nexus/driftbench-generate';

/**
 * The perfect model of the bank, as a model port. It is code, not a model: it knows every entry the generator
 * planted, and for each request it answers with the entries a model that reads perfectly would give, under
 * three limits a real model has.
 *
 * 1. It sees only what the request sends. An entry is reported when its anchor (the text that states it, as
 *    it sits in its source file) is inside a source block of the request. A chunker that cuts an anchor in two
 *    loses the entry.
 * 2. It writes what the contract asks for and nothing else. A key the system prompt's answer template does
 *    not show is left out, since the strict answer schema refuses unknown keys; a relation kind the template
 *    does not list is not reported. When the contract grows a key, the perfect model starts to use it.
 * 3. Its answer fits its budget: 16000 output tokens unless the request sets `maxTokens`, and a context of
 *    200000 tokens, at four characters a token (the defaults of the anthropic and openai clients). A longer
 *    answer is cut (`truncated`); a longer request is refused.
 *
 * It writes text as a model's tokeniser does: Unicode in NFC form, without zero-width characters or soft
 * hyphens. It quotes the text a passage says, so a quote from a JSON or YAML string is the decoded text.
 */

export const OUTPUT_TOKENS = 16_000;
export const CONTEXT_TOKENS = 200_000;
export const CHARS_PER_TOKEN = 4;

export type Role = 'axis' | 'detail';

type Common = {
  section: Section;
  /** The source path the entry quotes. */
  source: string;
  /** The text the model writes as the quote: the decoded passage. */
  quote: string;
  /** The text as it sits in the source file; it must be visible in the request for the entry to be reported. */
  anchor: string;
  /** An entry a reader who sees its context does not report: a deprecated or a replaced rule. */
  silent?: boolean;
  /**
   * Text the entry needs beside it in the same source block to be read right: a heading that scopes it, a
   * table header, a "deprecated" marker, the update that replaces it. Without it the model misreads: it drops
   * the entry, reports a silent one as live, or reports a rule without the condition the context gave.
   */
  context?: { anchor: string; ifMissing: 'drop' | 'report' | 'without-when' };
};

export type PlantedValue = Common & {
  type: 'value';
  dimension: { id: string; title: string; kind: string; role?: Role };
  value: { id: string; title: string };
  /** Keys a richer contract carries on a value, such as polarity or when. */
  fields?: Record<string, unknown>;
};

export type PlantedConstraint = Common & {
  type: 'constraint';
  forbid: Record<string, string>;
  reason: string;
};

export type PlantedPhrase = Omit<Common, 'quote'> & {
  type: 'phrase';
  dimension: string;
  value: string;
  text: string;
  lang: string;
  /** True when the phrase copies a source example: it then carries source and quote. */
  copied: boolean;
};

export type PlantedRelation = Common & {
  type: 'relation';
  relation: Record<string, unknown> & { kind: string };
};

export type Planted = PlantedValue | PlantedConstraint | PlantedPhrase | PlantedRelation;

/**
 * Text as a tokeniser writes it: NFC, no zero-width characters, soft hyphens or direction marks, a plain
 * space for a line or paragraph separator.
 */
export function asModelWrites(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD\u202A-\u202E]/g, '')
    .replace(/[\u2028\u2029]/g, ' ');
}

/** The keys of the first object of the template that starts at `start` in the system prompt. */
function templateKeys(system: string, start: RegExp): Set<string> {
  const match = start.exec(system);
  if (!match) return new Set();
  const from = match.index;
  let depth = 0;
  let end = from;
  for (let i = system.indexOf('{', from); i < system.length; i++) {
    const char = system[i];
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = system.slice(from, end);
  return new Set([...body.matchAll(/"([a-z_]+)":/g)].map((found) => found[1] as string));
}

/** What the contract in a system prompt lets a model say. */
export function contractOf(system: string): {
  dimensionKeys: Set<string>;
  valueKeys: Set<string>;
  relationKinds: Set<string>;
} {
  const dimensionKeys = templateKeys(system, /\{"id": "<dimension id>"/);
  // The value object sits inside the dimension template: read it on its own.
  const valueKeys = templateKeys(system, /\{"id": "<value id>"/);
  for (const key of valueKeys) if (key !== 'values') dimensionKeys.delete(key);
  const kinds = /"kind": "<([a-z_, ]+(?: or [a-z_]+)?)>"/.exec(system.slice(system.indexOf('"relations"')));
  const relationKinds = new Set(
    (kinds?.[1] ?? '')
      .split(/,\s*|\s+or\s+/)
      .map((kind) => kind.trim())
      .filter((kind) => kind !== ''),
  );
  return { dimensionKeys, valueKeys, relationKinds };
}

/** The source blocks of a request, by path; the whole source part when no block can be read. */
export function visibleText(user: string): Array<{ path: string; text: string }> {
  const blocks = [...user.matchAll(/<<<SOURCE (\S+) \([a-z]+\)\n([\s\S]*?)\nSOURCE \1>>>/g)].map((found) => ({
    path: found[1] as string,
    text: found[2] as string,
  }));
  if (blocks.length > 0) return blocks;
  const start = user.indexOf('Sources');
  return [{ path: '*', text: start >= 0 ? user.slice(start) : user }];
}

export type PerfectOptions = { outputTokens?: number; contextTokens?: number };

/** The perfect model over the planted entries. */
export function perfectPort(planted: readonly Planted[], options: PerfectOptions = {}): ModelPort {
  return {
    family: 'oracle',
    model: 'perfect model written by code from the planted entries',
    async complete(request: ModelRequest): Promise<string> {
      const section = sectionOf(request.user);
      if (!section) throw new ModelError('bad_response', 'the request does not name a section');
      const context = (options.contextTokens ?? CONTEXT_TOKENS) * CHARS_PER_TOKEN;
      if (request.system.length + request.user.length > context) {
        throw new ModelError('http', `the request is longer than a context of ${context} characters`, {
          status: 400,
        });
      }
      const answer = answerFor(section, request, planted);
      const text = JSON.stringify(answer);
      const budget = (request.maxTokens ?? options.outputTokens ?? OUTPUT_TOKENS) * CHARS_PER_TOKEN;
      if (text.length > budget) {
        throw new ModelError('truncated', `the answer needs ${text.length} characters, over ${budget}`);
      }
      return text;
    },
  };
}

/** The answer to one section request: the planted entries of the section the request lets the model see. */
export function answerFor(section: Section, request: ModelRequest, planted: readonly Planted[]) {
  const contract = contractOf(request.system);
  const blocks = visibleText(request.user);
  const locate = locator(blocks);
  const seen = planted
    .filter((entry) => entry.section === section)
    .map((entry) => ({ entry, found: locate(entry) }))
    .filter(({ found }) => found !== undefined)
    .sort((a, b) => (a.found?.at ?? 0) - (b.found?.at ?? 0))
    .flatMap(({ entry, found }) => {
      const block = blocks[found?.block ?? 0] as { text: string };
      const read = !entry.context || block.text.includes(entry.context.anchor);
      if (read) return entry.silent ? [] : [entry];
      const how = entry.context?.ifMissing;
      if (how === 'drop') return [];
      if (how === 'without-when' && entry.type === 'value' && entry.fields) {
        const { when: _when, ...fields } = entry.fields;
        return [{ ...entry, fields }];
      }
      return [entry];
    });
  const write = asModelWrites;

  const dimensions: Array<Record<string, unknown> & { values: Array<Record<string, unknown>> }> = [];
  const constraints: Array<Record<string, unknown>> = [];
  const phrases: Array<Record<string, unknown>> = [];
  const relations: Array<Record<string, unknown>> = [];
  for (const entry of seen) {
    if (entry.type === 'value') {
      let dimension = dimensions.find((candidate) => candidate.id === entry.dimension.id);
      if (!dimension) {
        dimension = {
          id: entry.dimension.id,
          title: entry.dimension.title,
          kind: entry.dimension.kind,
          ...(entry.dimension.role && contract.dimensionKeys.has('role')
            ? { role: entry.dimension.role }
            : {}),
          values: [],
        };
        dimensions.push(dimension);
      }
      const fields = Object.fromEntries(
        Object.entries(entry.fields ?? {}).filter(([key]) => contract.valueKeys.has(key)),
      );
      dimension.values.push({
        id: entry.value.id,
        title: entry.value.title,
        ...fields,
        source: entry.source,
        quote: write(entry.quote),
      });
    } else if (entry.type === 'constraint') {
      constraints.push({
        forbid: entry.forbid,
        reason: entry.reason,
        source: entry.source,
        quote: write(entry.quote),
      });
    } else if (entry.type === 'phrase') {
      const text = write(entry.text);
      phrases.push({
        dimension: entry.dimension,
        value: entry.value,
        text,
        lang: entry.lang,
        ...(entry.copied ? { source: entry.source, quote: text } : {}),
      });
    } else if (contract.relationKinds.has(entry.relation.kind)) {
      relations.push({ ...entry.relation, source: entry.source, quote: write(entry.quote) });
    }
  }
  return { section, dimensions, constraints, phrases, relations };
}

/**
 * Where each entry's anchor first appears in the request's source blocks (an offset over the blocks), or
 * undefined when it is not visible. Entries come mostly in text order, so a search starts where the previous
 * one ended and falls back to the whole block.
 */
function locator(
  blocks: Array<{ path: string; text: string }>,
): (entry: Planted) => { at: number; block: number } | undefined {
  const cursors = blocks.map(() => 0);
  const offsets: number[] = [];
  let total = 0;
  for (const block of blocks) {
    offsets.push(total);
    total += block.text.length + 1;
  }
  return (entry) => {
    for (const [index, block] of blocks.entries()) {
      if (!(block.path === '*' || block.path === entry.source || block.path.startsWith(`${entry.source}#`)))
        continue;
      let at = block.text.indexOf(entry.anchor, cursors[index]);
      if (at < 0) at = block.text.indexOf(entry.anchor);
      if (at >= 0) {
        cursors[index] = at;
        return { at: (offsets[index] as number) + at, block: index };
      }
    }
    return undefined;
  };
}
