import { createHash } from 'node:crypto';
import type { VariableStore } from '@agent-nexus/driftbench-space';
import { QuoteIndex } from '../extract/quote';

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

export type SourceCondition = {
  /** The clause, copied from the file. */
  text: string;
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

/**
 * Ids for a set of names: each name gets its slug; names that share one are ordered by name and the later ones get
 * a numeric suffix. The result depends on the set of names only.
 */
function idsFor(names: Iterable<string>): Map<string, string> {
  const bySlug = new Map<string, string[]>();
  for (const name of new Set(names)) {
    const id = slug(name);
    const list = bySlug.get(id);
    if (list) list.push(name);
    else bySlug.set(id, [name]);
  }
  const used = new Set(bySlug.keys());
  const out = new Map<string, string>();
  for (const [id, list] of bySlug) {
    list.sort();
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

type VariableDraft = {
  name: string;
  title: string;
  values: Map<string, ValueDraft>;
  total?: number;
};

const ownerKey = (entry: OwnerEntry) => JSON.stringify([entry.date, entry.words]);
const quoteKey = (entry: QuoteEntry) => JSON.stringify([entry.path, entry.quote]);

function ownerEntry(words: unknown, date: unknown): OwnerEntry | string {
  if (blank(words)) return 'the owner gave no words with the entry';
  if ((words as string).length > MAX_TEXT) return `the owner's words are longer than ${MAX_TEXT} characters`;
  if (!realDay(date)) return 'the owner gave a day that is not a real day written YYYY-MM-DD';
  return { kind: 'owner', words: words as string, date };
}

export function variablesFromSources(
  sources: VariableSources,
  options: VariablesFromSourcesOptions = {},
): VariablesFromSources {
  const refused: SourceRefusal[] = [];
  const refuse = (what: string, reason: string) => refused.push({ what, reason });

  // ---------------------------------------------------------------------------------------------- the estate
  const files = new Map(Object.entries(sources.estate?.files ?? {}));
  const index = new QuoteIndex(files);
  const drafts = new Map<string, VariableDraft>();
  const ruleVariables = new Map<string, Set<string>>();
  for (const rule of sources.estate?.rules ?? []) {
    const cited = ruleVariables.get(rule.id) ?? new Set<string>();
    ruleVariables.set(rule.id, cited);
    for (const condition of rule.conditions ?? []) {
      if (!index.contains(rule.source, condition.text)) {
        refuse(
          condition.text,
          'this clause is not in the file the rule names, so it cannot stand as a condition',
        );
      }
    }
    for (const tool of rule.tools ?? []) {
      const name = `${tool.tool}.${tool.field}`;
      for (const value of tool.values ?? []) {
        const what = `${name}.${value.id}`;
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
          draft = { name, title: name, values: new Map() };
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
  const variableIds = idsFor(drafts.keys());
  const byStoredId = new Map<string, VariableDraft>();
  for (const [name, draft] of drafts) byStoredId.set(variableIds.get(name) as string, draft);
  /** Per variable: the stored id of each value key, and the key of each stored id. */
  const valueIds = new Map<string, Map<string, string>>();
  const valueKeys = new Map<string, Map<string, string>>();
  for (const [name, draft] of drafts) {
    const ids = idsFor(draft.values.keys());
    valueIds.set(name, ids);
    valueKeys.set(name, new Map([...ids].map(([key, id]) => [id, key])));
  }

  const draftOfId = (id: string): VariableDraft | undefined => byStoredId.get(id);
  const idOfDraft = (draft: VariableDraft) => variableIds.get(draft.name) as string;
  /** The key of a value of a draft, by its stored id or by a name it was given. */
  const valueKeyOf = (draft: VariableDraft, given: string): string | undefined =>
    (valueKeys.get(draft.name) as Map<string, string>).get(given) ?? (draft.values.has(given) ? given : undefined);
  const addValue = (draft: VariableDraft, given: string): { key: string; created: boolean } => {
    const found = valueKeyOf(draft, given);
    if (found !== undefined) return { key: found, created: false };
    draft.values.set(given, {
      names: new Set([given]),
      title: given,
      quotes: new Map(),
      owner: new Map(),
      proposal: false,
    });
    // A name not yet in the id table gets a grammar id that no value of the variable holds.
    const keys = valueKeys.get(draft.name) as Map<string, string>;
    let candidate = slug(given);
    for (let n = 2; keys.has(candidate); n += 1) candidate = `${slug(given)}-${n}`;
    (valueIds.get(draft.name) as Map<string, string>).set(given, candidate);
    keys.set(candidate, given);
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
  const setHash = sha256(
    sessions
      .map((session) =>
        JSON.stringify([
          session.id,
          isRecord(session.values) ? Object.entries(session.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [],
        ]),
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
      refuse(idOfDraft(draft), 'the owner weighed some values of this variable and not all: a variable weighs all its values or none');
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
    ends.sort((x, y) => (x.join('=') < y.join('=') ? -1 : x.join('=') > y.join('=') ? 1 : 0));
    const key = JSON.stringify(ends);
    const pair = pairs.get(key) ?? { a: ends[0] as [string, string], b: ends[1] as [string, string], provenance: new Map() };
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
    const values = byText([...draft.values.entries()], ([key]) => ids.get(key) as string).map(([key, value]) => {
      const provenance: Provenance[] = [
        ...byText([...value.quotes.values()], quoteKey),
        ...(value.count === undefined || draft.total === undefined
          ? []
          : [{ kind: 'conversations' as const, count: value.count, total: draft.total, set_hash: setHash }]),
        ...byText([...value.owner.values()], ownerKey),
      ];
      return {
        id: ids.get(key) as string,
        title: value.title,
        ...(value.weight === undefined ? {} : { weight: value.weight }),
        ...(value.proposal ? { approved: false } : {}),
        ...(provenance.length > 0 ? { provenance } : {}),
      };
    });
    return {
      id: idOfDraft(draft),
      title: draft.title,
      kind: 'data' as const,
      role: 'detail' as const,
      approved: true,
      values,
    };
  });
  const constraints = byText([...pairs.values()], (pair) => JSON.stringify([pair.a, pair.b])).map((pair) => ({
    forbid: { [pair.a[0]]: pair.a[1], [pair.b[0]]: pair.b[1] },
    reason: 'an impossible pair the owner named',
    approved: true,
    provenance: byText([...pair.provenance.values()], ownerKey),
  }));
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
    refused: byText(refused, (r) => JSON.stringify([r.what, r.reason])),
    rules,
  };
}
