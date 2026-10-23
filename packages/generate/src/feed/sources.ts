import { createHash } from 'node:crypto';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { QuoteIndex } from '../extract/quote';
import { shareSubjects } from './subjects';

/**
 * The variable store from its three sources at once (docs/variables.md R1 to R5): the agent's own files, the
 * values past conversations show, and what the owner says. Code reads structure only: ids, quotes, counts, dates
 * and numbers that arrive as numbers. It matches no word of a clause. A condition span is read only through a
 * label that a reader wrote beside it (`label`), and a span with no label gives no variable.
 *
 * - Estate. Tool evidence names a tool, a field and listed values, each with the quote that justifies it and the
 *   file it is quoted from. A value whose quote the file does not hold (white space, typographic quotes, accents
 *   and invisible characters folded, case and punctuation not) is refused with a reason and kept out; a variable
 *   left with no value is not stored. A file is looked up by its exact path among the files given, never on disk.
 *   Text with an unpaired UTF-16 surrogate (not well-formed Unicode), in any key or value of any source, is refused
 *   with a reason by one pass at the entry: two such texts would encode alike and share an id or a hash.
 * - Conversations. Each session names the values it shows by variable and value id. A variable's total is the
 *   sessions that show it; a value's count is the sessions that show the value. A value of a variable the store
 *   has, absent from the store, joins it as a proposal (`approved: false`) with its counts. A variable no session
 *   shows gets no counts. The store keeps counts and a hash of the set, never a session id or a line of text.
 * - Owner. An owner entry adds a value, an impossible pair or a weight, with the owner's words and the day.
 *   An entry that names a missing variable or value, has blank words, an unreal day or a weight that is not a
 *   finite number from 0 is refused with a reason.
 *
 * The store is built in a canonical order, so the same sources in any order give the same bytes. Ids follow the id
 * grammar; where two names give one id they get suffixes in the order of their names, not of their arrival.
 */

/**
 * What a reader wrote about a clause. Code never reads the clause: a model or a person did, and this is their
 * answer. A comparison is `lt`, `le`, `gt` or `ge` (how the quantity is compared with the limit for the condition
 * to hold) or `eq` or `ne` (equal, not equal; the file format has no such comparison, so no boundary is written).
 */
export type SpanLabel =
  | {
      kind: 'numeric';
      subject: string;
      limit: number;
      comparison: 'lt' | 'le' | 'gt' | 'ge' | 'eq' | 'ne';
      unit?: string;
    }
  | { kind: 'range'; subject: string; low: number; high: number; unit?: string }
  | { kind: 'member'; subject: string; members: readonly string[] }
  | { kind: 'boolean'; subject: string }
  | { kind: 'none' };

export type SourceCondition = {
  /** The clause, copied from the file. */
  text: string;
  /** What a reader wrote about the clause. Without a label the clause gives no variable. */
  label?: SpanLabel;
};

export type SourceToolValue = { id: string; quote: string };

export type SourceTool = { tool: string; field: string; source: string; values: readonly SourceToolValue[] };

export type SourceRule = {
  id: string;
  source: string;
  conditions: readonly SourceCondition[];
  tools: readonly SourceTool[];
};

export type SourceSession = { id: string; values: Readonly<Record<string, string>> };

export type SourceOwner = {
  values?: ReadonlyArray<{ variable: string; value: string; words: string; date: string }>;
  impossible?: ReadonlyArray<{
    a: { variable: string; value: string };
    b: { variable: string; value: string };
    words: string;
    date: string;
  }>;
  weights?: ReadonlyArray<{ variable: string; value: string; weight: unknown; words: string; date: string }>;
};

export type VariableSources = {
  estate?: { files: Readonly<Record<string, string>>; rules: readonly SourceRule[] };
  conversations?: readonly SourceSession[];
  owner?: SourceOwner;
};

/** An entry the reader kept out, and why. `what` names it; the reason never repeats its text. */
export type SourceRefusal = { what: string; reason: string };

/** A rule of the estate and the variables whose values cite its tool quotes. */
export type SourceRuleVariables = { id: string; variables: string[] };

export type VariablesFromSources = {
  store: VariableStore;
  refused: SourceRefusal[];
  rules: SourceRuleVariables[];
  /**
   * The case each value of a condition variable stands for: a number below, at or above a limit, a listed member
   * or another string, true or false. By variable id, then value id. A value of tool evidence has none.
   */
  samples: Record<string, Record<string, number | string | boolean>>;
};

export type VariablesFromSourcesOptions = { agent?: string; version?: string };

type Provenance = NonNullable<VariableStore['variables'][number]['values'][number]['provenance']>[number];
type QuoteEntry = Extract<Provenance, { kind: 'quote' }>;
type OwnerEntry = Extract<Provenance, { kind: 'owner' }>;

const MAX_TEXT = 1000;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const blank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === '';

/** A clause with each run of white space folded to one space: the key under which its label is shared. */
const foldSpace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** An unpaired UTF-16 surrogate: text with one is not well-formed Unicode, and two such texts encode alike. */
const UNPAIRED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** The text with each unpaired surrogate shown as U+FFFD, for a refusal that names it. */
const shown = (text: string): string => text.replace(new RegExp(UNPAIRED.source, 'g'), '\uFFFD');
const NOT_WELL_FORMED =
  'a name or subject must be well-formed text: this one holds an unpaired UTF-16 surrogate, which cannot be told from another';

function realDay(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The id a name gives under the id grammar: letters, digits, dots, underscores and hyphens, a letter or digit first. */
function slug(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/, '');
  return cleaned === '' ? `n${sha256(name).slice(0, 8)}` : cleaned;
}

/** The end a hashed id carries; a name with this end is hashed too, so no name can take a hashed id. */
const HASHED = /-[0-9a-f]{12}$/;

/**
 * Ids for a set of names. A name that already is a valid id, and does not end like a hashed id, keeps it. Any other
 * name gets its slug and 12 hex digits of the hash of the name itself. The two kinds of id cannot meet, and a hashed
 * id depends on its own name only, so an id never changes when other names join or leave the set, in any order. Two
 * names that still end with one id (a crafted hash) are ordered by name and the later ones get a numeric suffix.
 */
function idsFor(names: Iterable<string>): Map<string, string> {
  const byId = new Map<string, string[]>();
  for (const name of new Set(names)) {
    const own = slug(name);
    const id = own === name && !HASHED.test(name) ? name : `${own}-${sha256(name).slice(0, 12)}`;
    const list = byId.get(id);
    if (list) list.push(name);
    else byId.set(id, [name]);
  }
  const used = new Set(byId.keys());
  const out = new Map<string, string>();
  for (const [id, list] of byId) {
    list.sort((x, y) => {
      const xOwn = x === id ? 0 : 1;
      const yOwn = y === id ? 0 : 1;
      return xOwn - yOwn || (x < y ? -1 : x > y ? 1 : 0);
    });
    out.set(list[0] as string, id);
    for (let n = 1; n < list.length; n += 1) {
      let candidate = `${id}-${n + 1}`;
      for (let k = n + 2; used.has(candidate); k += 1) candidate = `${id}-${k}`;
      used.add(candidate);
      out.set(list[n] as string, candidate);
    }
  }
  return out;
}

/**
 * Ids for the variables, by the rule of `idsFor`. A variable keeps its id text (a condition's subject, or the dotted
 * title of a tool and field) when that is a valid id, does not end like a hashed id and holds no dot that another kind
 * of variable could also write; otherwise the id is the slug of the text and 12 hex digits of the hash of the
 * variable's identity. So an id depends on its own variable only, and variables of different kinds that give one text
 * never share an id. Ids that still meet (a crafted hash) are ordered by identity and the later ones get a numeric
 * suffix.
 */
function variableIdsFor(drafts: ReadonlyMap<string, VariableDraft>): Map<string, string> {
  const byId = new Map<string, string[]>();
  for (const [key, draft] of drafts) {
    const text = draft.idText ?? draft.name;
    const own = slug(text);
    const keeps = own === text && !HASHED.test(text) && draft.plain !== false;
    const id = keeps ? own : `${own}-${sha256(key).slice(0, 12)}`;
    const list = byId.get(id);
    if (list) list.push(key);
    else byId.set(id, [key]);
  }
  const used = new Set(byId.keys());
  const out = new Map<string, string>();
  for (const [id, list] of byId) {
    const keepsId = (key: string): number => {
      const draft = drafts.get(key) as VariableDraft;
      return (draft.idText ?? draft.name) === id && draft.plain !== false ? 0 : 1;
    };
    list.sort((x, y) => keepsId(x) - keepsId(y) || (x < y ? -1 : x > y ? 1 : 0));
    out.set(list[0] as string, id);
    for (let n = 1; n < list.length; n += 1) {
      let candidate = `${id}-${n + 1}`;
      for (let k = n + 2; used.has(candidate); k += 1) candidate = `${id}-${k}`;
      used.add(candidate);
      out.set(list[n] as string, candidate);
    }
  }
  return out;
}

type ValueDraft = {
  /** The names this value was given (a tool value id, an owner or session value id). */
  names: Set<string>;
  title: string;
  quotes: Map<string, QuoteEntry>;
  owner: Map<string, OwnerEntry>;
  proposal: boolean;
  count?: number;
  weight?: number;
};

/** The edge of a numeric condition, by value key. */
type BoundaryDraft = {
  holds: string;
  fails: string;
  edge: string;
  limit: number;
  comparison: 'lt' | 'le' | 'gt' | 'ge';
  unit?: string;
  provenance: QuoteEntry;
};

type VariableDraft = {
  /** The identity of the variable (`identity`): its kind and the parts that name it, never joined or serialised. */
  name: string;
  title: string;
  /**
   * False when the id text holds a dot: a plain id is a tool's dotted title, and that title can also be written by
   * another tool and field (the pair that splits at the last dot keeps it) or be the subject of a condition. So a
   * condition with a dot in its subject, and a tool whose field holds a dot, take a hashed id. An unset flag is true.
   */
  plain?: boolean;
  /** The text the id is made from: the subject of a condition, or the dotted title of a tool and field. */
  idText?: string;
  values: Map<string, ValueDraft>;
  total?: number;
  /** For a condition variable: the sample of each value, by value key. */
  samples?: Map<string, number | string | boolean>;
  boundaries?: BoundaryDraft[];
};

const subjectKey = (subject: string): string =>
  subject.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

const decimalsOf = (n: number): number => {
  const text = String(n);
  const dot = text.indexOf('.');
  return /e/i.test(text) || dot < 0 ? 0 : text.length - dot - 1;
};
/** The finite number next to `n` in the given direction, or undefined when there is none. */
function neighbour(n: number, up: boolean): number | undefined {
  if (n === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, n);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, up === n > 0 ? bits + 1n : bits - 1n);
  const next = view.getFloat64(0);
  return Number.isFinite(next) ? next : undefined;
}
/**
 * `n` moved by `steps` (1 or -1) of its own last decimal place (a whole number moves by whole numbers). Where that
 * step is lost in the rounding of a large number, the next representable number. Undefined when none is finite.
 */
const around = (n: number, steps: number): number | undefined => {
  const places = decimalsOf(n);
  const moved = Number((n + steps * 10 ** -places).toFixed(places));
  if (Number.isFinite(moved) && (steps > 0 ? moved > n : moved < n)) return moved;
  return neighbour(n, steps > 0);
};
const numberKey = (x: number): string => (x < 0 ? `neg${-x}` : `v${x}`);

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const named = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/**
 * The one way this file builds a key out of text it did not write. A kind from a fixed list (no `|` in it), then each
 * part after its length: two different identities can never give one key, whatever the parts hold (dots, brackets,
 * quotes, text that looks like another key). A map is keyed on an identity, never on joined or serialised text.
 */
const identity = (kind: string, ...parts: readonly string[]): string =>
  `${kind}${parts.map((part) => `|${part.length}:${part}`).join('')}`;

const ownerKey = (entry: OwnerEntry) => identity('owner', entry.date, entry.words);
const quoteKey = (entry: QuoteEntry) => identity('quote', entry.path, entry.quote);

function ownerEntry(words: unknown, date: unknown): OwnerEntry | string {
  if (blank(words)) return 'the owner gave no words with the entry';
  if ((words as string).length > MAX_TEXT) return `the owner's words are longer than ${MAX_TEXT} characters`;
  if (!realDay(date)) return 'the owner gave a day that is not a real day written YYYY-MM-DD';
  return { kind: 'owner', words: words as string, date };
}

/** Whether a string, an array or an object holds, anywhere in its keys or values, a string that is not well-formed. */
function illFormedAnywhere(value: unknown): boolean {
  if (typeof value === 'string') return UNPAIRED.test(value);
  if (Array.isArray(value)) return value.some(illFormedAnywhere);
  if (isRecord(value)) {
    return Object.entries(value).some(([key, inner]) => UNPAIRED.test(key) || illFormedAnywhere(inner));
  }
  return false;
}

/** Whether an object has a key that is not well-formed, at its own level. */
const keyIllFormed = (value: unknown): boolean =>
  isRecord(value) && Object.keys(value).some((key) => UNPAIRED.test(key));

/**
 * The one well-formedness pass, before anything else reads the sources. Text with an unpaired UTF-16 surrogate, in a
 * key or a value at any depth, is not well-formed Unicode: two such texts encode to the same replacement text and
 * would share an id or a hash. Each entry that holds one (a file, a rule, a condition, a tool value, a session, an
 * owner entry) is left out and refused once, with a reason and its text escaped. What is left is read as given.
 */
function wellFormedSources(sources: VariableSources): { clean: VariableSources; refused: SourceRefusal[] } {
  const refused: SourceRefusal[] = [];
  const drop = (what: string): void => {
    refused.push({ what: shown(what), reason: NOT_WELL_FORMED });
  };
  const name = (value: unknown): string =>
    typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  const top = Object.keys(sources).filter((key) => UNPAIRED.test(key));
  for (const key of top) drop(`sources key ${key}`);
  let estate = top.length > 0 ? undefined : sources.estate;
  if (estate !== undefined && keyIllFormed(estate)) {
    drop('estate');
    estate = undefined;
  }
  if (estate !== undefined && isRecord(estate)) {
    // Entries are filtered and copied by `Object.fromEntries`, which defines each key as an own property: a file named
    // `__proto__` stays a file. No object here is filled by `object[key] = value` with a key from the input.
    const files = Object.fromEntries(
      Object.entries(estate.files ?? {}).filter(([path, text]) => {
        const bad = illFormedAnywhere([path, text]);
        if (bad) drop(`file ${path}`);
        return !bad;
      }),
    );
    const rules = (estate.rules ?? []).flatMap((rule) => {
      if (illFormedAnywhere([rule.id, rule.source]) || keyIllFormed(rule)) {
        drop(`rule ${name(rule.id)}`);
        return [];
      }
      const conditions = (rule.conditions ?? []).filter((condition) => {
        const bad = illFormedAnywhere(condition);
        if (bad) drop(name(condition?.text));
        return !bad;
      });
      const tools = (rule.tools ?? []).map((tool) => {
        // A malformed tool, field, source or key is refused once, whatever its values hold, even none.
        if (illFormedAnywhere([tool.tool, tool.field, tool.source]) || keyIllFormed(tool)) {
          drop(`${name(tool.tool)}.${name(tool.field)}`);
          return { ...tool, values: [] };
        }
        const values = (tool.values ?? []).filter((value) => {
          const bad = illFormedAnywhere(value);
          if (bad) drop(`${name(tool.tool)}.${name(tool.field)}.${name(value?.id)}`);
          return !bad;
        });
        return { ...tool, values };
      });
      return [{ ...rule, conditions, tools }];
    });
    estate = { ...estate, files, rules };
  }
  const conversations = (top.length > 0 ? undefined : sources.conversations)?.filter((session) => {
    const bad = illFormedAnywhere(session);
    if (bad) drop(`session ${name(session?.id)}`);
    return !bad;
  });
  let owner = top.length > 0 ? undefined : sources.owner;
  if (owner !== undefined && keyIllFormed(owner)) {
    drop('owner');
    owner = undefined;
  }
  if (owner !== undefined && isRecord(owner)) {
    const keep = <T>(list: readonly T[] | undefined, kind: string): T[] | undefined =>
      list?.filter((entry) => {
        const bad = illFormedAnywhere(entry);
        if (bad) drop(`owner ${kind} ${name(entry)}`);
        return !bad;
      });
    owner = {
      ...owner,
      ...(owner.values === undefined
        ? {}
        : { values: keep(owner.values, 'value') as NonNullable<SourceOwner['values']> }),
      ...(owner.impossible === undefined
        ? {}
        : { impossible: keep(owner.impossible, 'pair') as NonNullable<SourceOwner['impossible']> }),
      ...(owner.weights === undefined
        ? {}
        : { weights: keep(owner.weights, 'weight') as NonNullable<SourceOwner['weights']> }),
    };
  }
  const clean: VariableSources = {
    ...(estate === undefined ? {} : { estate }),
    ...(conversations === undefined ? {} : { conversations }),
    ...(owner === undefined ? {} : { owner }),
  };
  return { clean, refused };
}

export function variablesFromSources(
  sources: VariableSources,
  options: VariablesFromSourcesOptions = {},
): VariablesFromSources {
  const { clean, refused: illFormed } = wellFormedSources(sources);
  const built = readSources(clean, options);
  if (illFormed.length === 0) return built;
  return {
    ...built,
    refused: [...built.refused, ...illFormed].sort((x, y) => {
      const [kx, ky] = [identity('refusal', x.what, x.reason), identity('refusal', y.what, y.reason)];
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    }),
  };
}

function readSources(sources: VariableSources, options: VariablesFromSourcesOptions): VariablesFromSources {
  const refused: SourceRefusal[] = [];
  // Every refusal prints its text through one escape: a lone surrogate is shown as U+FFFD, never as itself.
  const refuse = (what: string, reason: string) => refused.push({ what: shown(what), reason: shown(reason) });

  // ---------------------------------------------------------------------------------------------- the estate
  const files = new Map(Object.entries(sources.estate?.files ?? {}));
  const index = new QuoteIndex(files);
  const drafts = new Map<string, VariableDraft>();

  const conditionDraft = (kind: string, idText: string, title: string): VariableDraft => {
    const name = identity(kind, idText);
    let draft = drafts.get(name);
    if (!draft) {
      draft = {
        name,
        title,
        idText,
        plain: !idText.includes('.'),
        values: new Map(),
        samples: new Map(),
        boundaries: [],
      };
      drafts.set(name, draft);
    }
    return draft;
  };
  const conditionValue = (
    draft: VariableDraft,
    key: string,
    title: string,
    sample: number | string | boolean,
    entry: QuoteEntry,
  ): void => {
    let value = draft.values.get(key);
    if (!value) {
      value = { names: new Set([key]), title, quotes: new Map(), owner: new Map(), proposal: false };
      draft.values.set(key, value);
      draft.samples?.set(key, sample);
    }
    value.quotes.set(quoteKey(entry), entry);
  };
  /** Writes the variable of one labelled clause; returns its name, or undefined when the label is not usable. */
  const conditionVariable = (label: SpanLabel, entry: QuoteEntry): string | undefined => {
    if (label.kind === 'numeric' || label.kind === 'range') {
      if (!named(label.subject) || (label.unit !== undefined && !named(label.unit))) return undefined;
      const name = subjectKey(label.subject);
      if (label.kind === 'numeric') {
        if (!finite(label.limit)) return undefined;
        const draft = conditionDraft('condition-numeric', name, label.subject);
        const below = around(label.limit, -1);
        const above = around(label.limit, 1);
        if (below === undefined || above === undefined) return undefined;
        const [low, at, high] = [below, label.limit, above];
        for (const sample of [low, at, high]) {
          conditionValue(draft, numberKey(sample), `${label.subject}: ${sample}`, sample, entry);
        }
        const c = label.comparison;
        if (c === 'lt' || c === 'le' || c === 'gt' || c === 'ge') {
          const above = c === 'gt' || c === 'ge';
          const boundary: BoundaryDraft = {
            holds: numberKey(above ? high : low),
            fails: numberKey(above ? low : high),
            edge: numberKey(at),
            limit: at,
            comparison: c,
            ...(label.unit === undefined ? {} : { unit: label.unit }),
            provenance: entry,
          };
          // Of the clauses that give one boundary, the one with the smallest quote key is cited, whatever the order.
          const same = (draft.boundaries ?? []).find((b) => b.limit === at && b.comparison === c);
          if (!same) draft.boundaries?.push(boundary);
          else if (quoteKey(entry) < quoteKey(same.provenance)) same.provenance = entry;
        }
        return draft.name;
      }
      if (!finite(label.low) || !finite(label.high) || label.low >= label.high) return undefined;
      const draft = conditionDraft('condition-numeric', name, label.subject);
      let inside = label.low / 2 + label.high / 2;
      if (Number.isInteger(label.low) && Number.isInteger(label.high)) {
        const whole = Math.floor(inside);
        if (whole > label.low) inside = whole;
        else inside = label.low + 0.5;
      }
      if (!(inside > label.low && inside < label.high)) {
        const next = neighbour(label.low, true);
        if (next === undefined || !(next < label.high)) return undefined;
        inside = next;
      }
      const outsideLow = around(label.low, -1);
      const outsideHigh = around(label.high, 1);
      if (outsideLow === undefined || outsideHigh === undefined) return undefined;
      const samples = [outsideLow, label.low, inside, label.high, outsideHigh];
      for (const sample of samples)
        conditionValue(draft, numberKey(sample), `${label.subject}: ${sample}`, sample, entry);
      return draft.name;
    }
    if (label.kind === 'member') {
      const members = [...new Set((label.members ?? []).filter(named).map((m) => m.trim()))];
      if (!named(label.subject) || members.length === 0) return undefined;
      const draft = conditionDraft(
        'condition-member',
        `${subjectKey(label.subject)} (member)`,
        label.subject,
      );
      for (const member of members)
        conditionValue(draft, `m:${member}`, `${label.subject}: ${member}`, member, entry);
      let other = 'other';
      while (members.includes(other)) other += '#';
      conditionValue(draft, 'other', `${label.subject}: ${other}`, other, entry);
      return draft.name;
    }
    if (label.kind === 'boolean') {
      if (!named(label.subject)) return undefined;
      const draft = conditionDraft(
        'condition-boolean',
        `${subjectKey(label.subject)} (boolean)`,
        label.subject,
      );
      conditionValue(draft, 'true', `${label.subject}: true`, true, entry);
      conditionValue(draft, 'false', `${label.subject}: false`, false, entry);
      return draft.name;
    }
    return undefined;
  };
  // One clause has one label, however its white space is written: of the labels given to the spellings of a clause
  // (white space folded, nothing else), the one with the smallest serialisation is used for all, so the choice does not
  // depend on the order of the rules. A spelling with no label takes the label of another spelling.
  const clauseLabel = new Map<string, SpanLabel>();
  for (const rule of sources.estate?.rules ?? []) {
    for (const condition of rule.conditions ?? []) {
      if (condition.label === undefined || typeof condition.text !== 'string') continue;
      const key = foldSpace(condition.text);
      const known = clauseLabel.get(key);
      if (known === undefined || JSON.stringify(condition.label) < JSON.stringify(known)) {
        clauseLabel.set(key, condition.label);
      }
    }
  }
  // One quantity, one subject: clauses with the same text up to the first digit or symbol share the subject of the
  // first of them in text order (./subjects.ts), so a reader that named one quantity two ways still gives one variable.
  // A clause that will be refused (too long, or not in its file) lends its subject to no other.
  const usable = new Set<string>();
  for (const rule of sources.estate?.rules ?? []) {
    for (const condition of rule.conditions ?? []) {
      if (typeof condition.text !== 'string' || condition.text.length > MAX_TEXT) continue;
      if (index.contains(rule.source, condition.text)) usable.add(foldSpace(condition.text));
    }
  }
  const shared = shareSubjects(
    [...clauseLabel].filter(([text]) => usable.has(text)).map(([text, label]) => ({ text, label })),
  );
  for (const { text, label } of shared) if (label !== undefined) clauseLabel.set(text, label);
  const ruleVariables = new Map<string, Set<string>>();
  for (const rule of sources.estate?.rules ?? []) {
    const cited = ruleVariables.get(rule.id) ?? new Set<string>();
    ruleVariables.set(rule.id, cited);
    for (const condition of rule.conditions ?? []) {
      if (typeof condition.text === 'string' && condition.text.length > MAX_TEXT) {
        refuse(
          `${condition.text.slice(0, 40)}...`,
          `the clause is longer than ${MAX_TEXT} characters, so it cannot stand as a quote`,
        );
        continue;
      }
      if (!index.contains(rule.source, condition.text)) {
        refuse(
          condition.text,
          'this clause is not in the file the rule names, so it cannot stand as a condition',
        );
        continue;
      }
      const label = clauseLabel.get(foldSpace(condition.text));
      if (label === undefined || label.kind === 'none') continue;
      const entry: QuoteEntry = { kind: 'quote', path: rule.source, quote: condition.text };
      const made = conditionVariable(label, entry);
      if (made === undefined)
        refuse(condition.text, 'the label written for this clause is not a usable condition');
      else cited.add(made);
    }
    for (const tool of rule.tools ?? []) {
      const title = `${tool.tool}.${tool.field}`;
      // The pair, not its dotted title, identifies the variable: "a.b" with "c" and "a" with "b.c" are two.
      const name = identity('tool-field', String(tool.tool), String(tool.field));
      for (const value of tool.values ?? []) {
        const what = `${title}.${value.id}`;
        let reason: string | undefined;
        if (blank(value.quote)) reason = 'the value has no quote to stand on';
        else if (value.quote.length > MAX_TEXT) reason = `the quote is longer than ${MAX_TEXT} characters`;
        else if (!index.has(tool.source)) reason = 'the file the quote names is not among the files given';
        else if (!index.contains(tool.source, value.quote)) reason = 'the file does not hold this quote';
        if (reason !== undefined) {
          refuse(what, reason);
          continue;
        }
        let draft = drafts.get(name);
        if (!draft) {
          draft = { name, title, idText: title, plain: !String(tool.field).includes('.'), values: new Map() };
          drafts.set(name, draft);
        }
        let valueDraft = draft.values.get(value.id);
        if (!valueDraft) {
          valueDraft = {
            names: new Set([value.id]),
            title: value.id,
            quotes: new Map(),
            owner: new Map(),
            proposal: false,
          };
          draft.values.set(value.id, valueDraft);
        }
        const entry: QuoteEntry = { kind: 'quote', path: tool.source, quote: value.quote };
        valueDraft.quotes.set(quoteKey(entry), entry);
        cited.add(name);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- ids
  const variableIds = variableIdsFor(drafts);
  const byStoredId = new Map<string, VariableDraft>();
  for (const [name, draft] of drafts) byStoredId.set(variableIds.get(name) as string, draft);
  /** Per variable: the key of each stored id the estate's own values have, before any value joins. */
  const estateKeys = new Map<string, Map<string, string>>();
  for (const [name, draft] of drafts) {
    const ids = idsFor(draft.values.keys());
    estateKeys.set(name, new Map([...ids].map(([key, id]) => [id, key])));
  }
  /** Per variable: the stored id of each value key, and the key of each stored id. Settled once every value is in. */
  const valueIds = new Map<string, Map<string, string>>();
  const valueKeys = new Map<string, Map<string, string>>();
  const settleValueIds = (): void => {
    for (const [name, draft] of drafts) {
      const ids = idsFor(draft.values.keys());
      valueIds.set(name, ids);
      valueKeys.set(name, new Map([...ids].map(([key, id]) => [id, key])));
    }
  };
  settleValueIds();

  const draftOfId = (id: string): VariableDraft | undefined => byStoredId.get(id);
  const idOfDraft = (draft: VariableDraft) => variableIds.get(draft.name) as string;
  /** The key of a value of a draft, by a name it was given, else by its stored id. */
  const valueKeyOf = (draft: VariableDraft, given: string): string | undefined =>
    draft.values.has(given) ? given : (valueKeys.get(draft.name) as Map<string, string>).get(given);
  /**
   * A name the draft holds is that value; else a stored id of an estate value is that value; else the name is a new
   * value. A new value's id is settled later, from the set of names, so no arrival order shows in it.
   */
  const addValue = (draft: VariableDraft, given: string): { key: string; created: boolean } => {
    if (draft.values.has(given)) return { key: given, created: false };
    const fromEstate = (estateKeys.get(draft.name) as Map<string, string>).get(given);
    if (fromEstate !== undefined) return { key: fromEstate, created: false };
    draft.values.set(given, {
      names: new Set([given]),
      title: given,
      quotes: new Map(),
      owner: new Map(),
      proposal: false,
    });
    return { key: given, created: true };
  };

  // ---------------------------------------------------------------------------------------------- owner values
  const owner = sources.owner ?? {};
  for (const entry of owner.values ?? []) {
    const what = `${entry.variable}=${entry.value}`;
    const stamp = ownerEntry(entry.words, entry.date);
    if (typeof stamp === 'string') {
      refuse(what, stamp);
      continue;
    }
    const draft = draftOfId(entry.variable);
    if (!draft) {
      refuse(what, 'the store has no variable with this id');
      continue;
    }
    if (blank(entry.value)) {
      refuse(what, 'the owner named no value');
      continue;
    }
    const { key } = addValue(draft, entry.value);
    (draft.values.get(key) as ValueDraft).owner.set(ownerKey(stamp), stamp);
  }

  // ---------------------------------------------------------------------------------------------- conversations
  const sessions = sources.conversations ?? [];
  const seenVariables = new Map<string, Map<string, number>>();
  const unknown = new Set<string>();
  for (const session of sessions) {
    if (!isRecord(session.values)) continue;
    for (const [variableId, valueId] of Object.entries(session.values)) {
      const draft = draftOfId(variableId);
      if (!draft) {
        unknown.add(variableId);
        continue;
      }
      if (typeof valueId !== 'string' || valueId === '') continue;
      const { key, created } = addValue(draft, valueId);
      const value = draft.values.get(key) as ValueDraft;
      if (created) value.proposal = true;
      const counts = seenVariables.get(variableId) ?? new Map<string, number>();
      seenVariables.set(variableId, counts);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const variableId of [...unknown].sort()) {
    refuse(variableId, 'no variable of the store has this id, so the sessions that show it were not counted');
  }
  settleValueIds();
  const setHash = sha256(
    sessions
      .map((session) =>
        identity(
          'session',
          String(session.id),
          ...(isRecord(session.values)
            ? Object.entries(session.values)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .flatMap(([variable, value]) => [variable, String(value)])
            : []),
        ),
      )
      .sort()
      .join('\n'),
  );
  for (const [variableId, counts] of seenVariables) {
    const draft = draftOfId(variableId) as VariableDraft;
    let total = 0;
    for (const n of counts.values()) total += n;
    draft.total = total;
    for (const [key, value] of draft.values) value.count = counts.get(key) ?? 0;
  }

  // ---------------------------------------------------------------------------------------------- owner weights
  const declared = new Map<VariableDraft, Map<string, number>>();
  for (const entry of owner.weights ?? []) {
    const what = `${entry.variable}=${entry.value}`;
    const stamp = ownerEntry(entry.words, entry.date);
    if (typeof stamp === 'string') {
      refuse(what, stamp);
      continue;
    }
    const draft = draftOfId(entry.variable);
    const key = draft === undefined ? undefined : valueKeyOf(draft, entry.value);
    if (!draft || key === undefined) {
      refuse(what, 'the store has no such variable and value to weigh');
      continue;
    }
    if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0) {
      refuse(what, 'a weight is a finite number from 0 up');
      continue;
    }
    const map = declared.get(draft) ?? new Map<string, number>();
    declared.set(draft, map);
    map.set(key, entry.weight);
    (draft.values.get(key) as ValueDraft).owner.set(ownerKey(stamp), stamp);
  }
  for (const [draft, map] of declared) {
    const whole = [...draft.values.keys()].every((key) => map.has(key));
    const sum = [...map.values()].reduce((a, b) => a + b, 0);
    if (!whole) {
      refuse(
        idOfDraft(draft),
        'the owner weighed some values of this variable and not all: a variable weighs all its values or none',
      );
    } else if (sum <= 0) {
      refuse(idOfDraft(draft), 'every weight the owner gave for this variable is 0');
    } else {
      for (const [key, weight] of map) (draft.values.get(key) as ValueDraft).weight = weight;
    }
  }
  for (const draft of drafts.values()) {
    if (draft.total === undefined) continue;
    if ([...draft.values.values()].every((value) => value.weight !== undefined)) continue;
    for (const value of draft.values.values()) value.weight = value.count ?? 0;
  }

  // ---------------------------------------------------------------------------------------------- owner pairs
  type Pair = { a: [string, string]; b: [string, string]; provenance: Map<string, OwnerEntry> };
  const pairs = new Map<string, Pair>();
  for (const entry of owner.impossible ?? []) {
    const what = `${entry.a?.variable}=${entry.a?.value} with ${entry.b?.variable}=${entry.b?.value}`;
    const stamp = ownerEntry(entry.words, entry.date);
    if (typeof stamp === 'string') {
      refuse(what, stamp);
      continue;
    }
    const ends: Array<[string, string]> = [];
    for (const end of [entry.a, entry.b]) {
      const draft = end === undefined ? undefined : draftOfId(end.variable);
      const key = draft === undefined || end === undefined ? undefined : valueKeyOf(draft, end.value);
      if (!draft || key === undefined) break;
      ends.push([idOfDraft(draft), (valueIds.get(draft.name) as Map<string, string>).get(key) as string]);
    }
    if (ends.length < 2) {
      refuse(what, 'the store lacks a variable or a value this pair names');
      continue;
    }
    if (ends[0]?.[0] === ends[1]?.[0]) {
      refuse(what, 'the two values are of one variable, which never holds both: the pair excludes nothing');
      continue;
    }
    const endKey = (end: [string, string]) => identity('end', end[0], end[1]);
    ends.sort((x, y) => (endKey(x) < endKey(y) ? -1 : endKey(x) > endKey(y) ? 1 : 0));
    const key = identity('pair', ...ends.flat());
    const pair = pairs.get(key) ?? {
      a: ends[0] as [string, string],
      b: ends[1] as [string, string],
      provenance: new Map(),
    };
    pairs.set(key, pair);
    pair.provenance.set(ownerKey(stamp), stamp);
  }

  // ---------------------------------------------------------------------------------------------- assemble
  const byText = <T>(items: T[], text: (item: T) => string): T[] =>
    [...items].sort((x, y) => (text(x) < text(y) ? -1 : text(x) > text(y) ? 1 : 0));
  const variables = byText(
    [...drafts.values()].filter((draft) => draft.values.size > 0),
    (draft) => idOfDraft(draft),
  ).map((draft) => {
    const ids = valueIds.get(draft.name) as Map<string, string>;
    const values = byText([...draft.values.entries()], ([key]) => ids.get(key) as string).map(
      ([key, value]) => {
        const provenance: Provenance[] = [
          ...byText([...value.quotes.values()], quoteKey),
          ...(value.count === undefined || draft.total === undefined
            ? []
            : [
                { kind: 'conversations' as const, count: value.count, total: draft.total, set_hash: setHash },
              ]),
          ...byText([...value.owner.values()], ownerKey),
        ];
        return {
          id: ids.get(key) as string,
          title: value.title,
          ...(value.weight === undefined ? {} : { weight: value.weight }),
          ...(value.proposal ? { approved: false } : {}),
          ...(provenance.length > 0 ? { provenance } : {}),
        };
      },
    );
    const boundaries = (draft.boundaries ?? []).map((boundary) => ({
      holds: ids.get(boundary.holds) as string,
      fails: ids.get(boundary.fails) as string,
      edge: ids.get(boundary.edge) as string,
      limit: boundary.limit,
      comparison: boundary.comparison,
      ...(boundary.unit === undefined ? {} : { unit: boundary.unit }),
      provenance: [boundary.provenance],
    }));
    return {
      id: idOfDraft(draft),
      title: draft.title,
      kind: 'data' as const,
      role: 'detail' as const,
      approved: true,
      values,
      ...(boundaries.length > 0 ? { boundaries } : {}),
    };
  });
  const samples: Record<string, Record<string, number | string | boolean>> = {};
  for (const draft of drafts.values()) {
    if (draft.values.size === 0 || !draft.samples || draft.samples.size === 0) continue;
    const ids = valueIds.get(draft.name) as Map<string, string>;
    const row: Record<string, number | string | boolean> = {};
    for (const [key, sample] of draft.samples) row[ids.get(key) as string] = sample;
    samples[idOfDraft(draft)] = row;
  }
  const constraints = byText([...pairs.values()], (pair) => identity('pair', ...pair.a, ...pair.b)).map(
    (pair) => ({
      forbid: { [pair.a[0]]: pair.a[1], [pair.b[0]]: pair.b[1] },
      reason: 'an impossible pair the owner named',
      approved: true,
      provenance: byText([...pair.provenance.values()], ownerKey),
    }),
  );
  const rules = byText(
    [...ruleVariables.entries()].map(([id, cited]) => ({
      id,
      variables: byText(
        [...cited].flatMap((name) => {
          const id2 = variableIds.get(name);
          return id2 !== undefined && drafts.get(name)?.values.size ? [id2] : [];
        }),
        (x) => x,
      ),
    })),
    (rule) => rule.id,
  );
  const store = {
    format: 1,
    agent: options.agent ?? 'sources',
    version: options.version ?? '1',
    prior: { kind: 'declared' },
    variables,
    constraints,
  } as unknown as VariableStore;
  return {
    store,
    refused: byText(refused, (r) => identity('refusal', r.what, r.reason)),
    rules,
    samples,
  };
}
