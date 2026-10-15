import type { Assertion, EndStateSpec, GuardExpect, ToolExpect } from '@agent-nexus/driftbench-core';
import { isPlainObject } from '@agent-nexus/driftbench-core';
import {
  type PathRelation,
  PENDING_STAGE,
  type Proposal,
  type ProposalPhrase,
  type RecoveryRelation,
  type RecoveryTool,
  type Slots,
  type StatesRelation,
  type TaskFamilyRelation,
  type UsesToolRelation,
  type When,
} from '../extract/proposal';

/**
 * The approved relations of a map, ready for the generator: the paths of each flow, the tools a flow or a
 * behaviour calls, the concrete values a data value stands for, how a flow recovers from each deviation
 * class, and the language every reply is in. Code derives every machine Then from these; a model only
 * proposed them, with quotes, and a person approved them.
 */
export type Relations = {
  paths: PathRelation[];
  usesTools: UsesToolRelation[];
  /** What the reply of a turn must state. */
  states: StatesRelation[];
  /** The task families that write a flow's specs. */
  taskFamilies: TaskFamilyRelation[];
  /** Slot values by `dimension=value`. */
  binds: ReadonlyMap<string, Slots>;
  recoveries: RecoveryRelation[];
  /** The language every reply is in, as a spec writes it (EN); undefined when the map fixes none. */
  replyLanguage: string | undefined;
  /** Replies the agent sends to one user turn: `one` unless an approved `reply_count` relation says `any`. */
  repliesPerTurn: 'one' | 'any';
};

export const EMPTY_RELATIONS: Relations = {
  paths: [],
  usesTools: [],
  states: [],
  taskFamilies: [],
  binds: new Map(),
  recoveries: [],
  replyLanguage: undefined,
  repliesPerTurn: 'one',
};

/** The approved relations whose references are all approved values. */
export function readRelations(
  proposal: Proposal,
  approvedValue: (dimension: string, value: string) => boolean,
): Relations {
  const relations = (proposal.relations ?? []).filter((relation) => relation.approved);
  const whenOk = (when: When | undefined) =>
    when === undefined ||
    Object.entries(when).every(([dimension, values]) =>
      values.some((value) => approvedValue(dimension, value)),
    );
  const paths = relations.flatMap((relation) =>
    relation.kind === 'path' && approvedValue('flow', relation.flow) && whenOk(relation.when)
      ? [relation]
      : [],
  );
  const usesTools = relations.flatMap((relation) =>
    relation.kind === 'uses_tool' &&
    approvedValue(relation.subject.dimension, relation.subject.value) &&
    whenOk(relation.when)
      ? [relation]
      : [],
  );
  const states = relations.flatMap((relation) =>
    relation.kind === 'states' &&
    approvedValue(relation.subject.dimension, relation.subject.value) &&
    whenOk(relation.when)
      ? [relation]
      : [],
  );
  const taskFamilies = relations.flatMap((relation) =>
    relation.kind === 'task_family' && approvedValue('flow', relation.flow) ? [relation] : [],
  );
  const binds = new Map<string, Slots>();
  for (const relation of relations) {
    if (relation.kind !== 'binds') continue;
    if (!approvedValue(relation.subject.dimension, relation.subject.value)) continue;
    const key = `${relation.subject.dimension}=${relation.subject.value}`;
    binds.set(key, { ...(binds.get(key) ?? {}), ...relation.slots });
  }
  const recoveries = relations.flatMap((relation) =>
    relation.kind === 'recovery' && approvedValue('deviation', relation.class) ? [relation] : [],
  );
  const language = relations.find(
    (relation) =>
      relation.kind === 'reply_language' && approvedValue(relation.subject.dimension, relation.subject.value),
  );
  const replyCount = relations.find((relation) => relation.kind === 'reply_count');
  return {
    paths,
    usesTools,
    states,
    taskFamilies,
    binds,
    recoveries,
    replyLanguage: language?.kind === 'reply_language' ? language.lang.toUpperCase() : undefined,
    repliesPerTurn: replyCount?.kind === 'reply_count' ? replyCount.per_turn : 'one',
  };
}

/** The cell as the `when` of an entry reads it: a value id per dimension id, the stage and flow included. */
export type Context = Readonly<Record<string, string>>;

/** True when every dimension the `when` names holds one of its listed values in the context. */
export function matches(when: When | undefined, context: Context): boolean {
  if (when === undefined) return true;
  return Object.entries(when).every(([dimension, values]) => {
    const held = context[dimension];
    return held !== undefined && values.includes(held);
  });
}

/** One recovery for a class in a flow: every approved entry that holds there, merged. */
export type Recovery = {
  stageAfter: string | undefined;
  at: string[] | undefined;
  must: string[];
  mustNot: string[];
  guards: GuardExpect[];
  tools: RecoveryTool[];
  /** The entries merged, for the record. */
  entries: number;
};

/**
 * The recovery of a class in a flow (and, for a tool failure, of one tool): the stage after is the first one
 * an entry states, the probe stages are the stages every entry that names some allows, and the words,
 * guards and calls add up. Undefined when no approved entry holds.
 */
export function recoveryFor(
  relations: Relations,
  classId: string,
  flow: string,
  tool?: string,
): Recovery | undefined {
  const entries = relations.recoveries.filter(
    (entry) =>
      entry.class === classId &&
      entry.flows.includes(flow) &&
      (tool === undefined ? entry.tool === undefined : entry.tool === tool),
  );
  if (entries.length === 0) return undefined;
  let at: string[] | undefined;
  for (const entry of entries) {
    if (!entry.at) continue;
    at = at === undefined ? [...entry.at] : at.filter((stage) => entry.at?.includes(stage));
  }
  const unique = (items: string[]) => [...new Set(items)];
  return {
    stageAfter: entries.find((entry) => entry.stage_after !== undefined)?.stage_after,
    at,
    must: unique(entries.flatMap((entry) => entry.must ?? [])),
    mustNot: unique(entries.flatMap((entry) => entry.must_not ?? [])),
    guards: entries.flatMap((entry) => entry.guards ?? []),
    tools: entries.flatMap((entry) => entry.tools ?? []),
    entries: entries.length,
  };
}

/** The tools whose failure the map gives a recovery for in a flow. */
export function failureTools(relations: Relations, classId: string, flow: string): string[] {
  return [
    ...new Set(
      relations.recoveries
        .filter((entry) => entry.class === classId && entry.flows.includes(flow) && entry.tool !== undefined)
        .map((entry) => entry.tool as string),
    ),
  ];
}

/** The stage a recovery ends in, given the stage the conversation had reached. */
export function stageAfter(recovery: Recovery, pending: string): string | undefined {
  if (recovery.stageAfter === undefined) return undefined;
  return recovery.stageAfter === PENDING_STAGE ? pending : recovery.stageAfter;
}

// Slots -------------------------------------------------------------------------------------------------

const SLOT = /\{([a-z][a-z0-9_]*)\}/g;
const slotCache = new Map<string, readonly string[]>();

function slotNames(text: string): readonly string[] {
  const known = slotCache.get(text);
  if (known) return known;
  const names = [...text.matchAll(SLOT)].map((match) => match[1] as string);
  // Bound both entry count and retained text independently of generated suite size.
  if (text.length <= 1024) {
    if (slotCache.size >= 2048) slotCache.clear();
    slotCache.set(text, names);
  }
  return names;
}

/** The slots a text reads. */
export function slotsIn(text: string): string[] {
  return [...slotNames(text)];
}

/** The slots every string of a value reads, nested values included. */
export function slotsOf(value: unknown): string[] {
  const out: string[] = [];
  appendSlots(value, out);
  return out;
}

function appendSlots(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    for (const name of slotNames(value)) out.push(name);
  } else if (Array.isArray(value)) {
    const length = value.length;
    for (let index = 0; index < length; index += 1) if (index in value) appendSlots(value[index], out);
  } else if (isPlainObject(value)) {
    for (const child of Object.values(value)) appendSlots(child, out);
  }
}

export type Filled<T> = { ok: true; value: T } | { ok: false; missing: string[] };

const filledCache = new Map<string, Map<string, string>>();
let filledEntries = 0;
let filledCharacters = 0;

/** A text with each `{slot}` replaced; `literal` writes a value as a literal regular expression. */
export function fillText(text: string, slots: Slots, literal = false): Filled<string> {
  const names = slotNames(text);
  if (names.length === 0) return { ok: true, value: text };
  const missing = names.filter((name) => slots[name] === undefined);
  if (missing.length > 0) return { ok: false, missing: [...new Set(missing)] };
  const values = names.map((name) => slots[name] as string);
  const key =
    text.length <= 1024 && values.every((value) => typeof value === 'string')
      ? `${literal ? '1' : '0'}${JSON.stringify(values)}`
      : undefined;
  const cached = key === undefined ? undefined : filledCache.get(text)?.get(key);
  if (cached !== undefined) return { ok: true, value: cached };
  let at = 0;
  const value = text.replace(SLOT, () => {
    const replacement = values[at++] as string;
    return literal ? escapeRegExp(replacement) : replacement;
  });
  if (key !== undefined && value.length <= 4096 && key.length <= 4096) {
    const size = text.length + key.length + value.length;
    if (filledEntries >= 4096 || filledCharacters + size > 1_000_000) {
      filledCache.clear();
      filledEntries = 0;
      filledCharacters = 0;
    }
    const byValues = filledCache.get(text) ?? new Map<string, string>();
    byValues.set(key, value);
    filledCache.set(text, byValues);
    filledEntries += 1;
    filledCharacters += size;
  }
  return { ok: true, value };
}

/** A value with every `{slot}` in its strings replaced. */
export function fillValue<T>(value: T, slots: Slots): Filled<T> {
  const missing = [...new Set(slotsOf(value).filter((name) => slots[name] === undefined))];
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: fillNode(value, slots) as T };
}

function fillNode(node: unknown, slots: Slots): unknown {
  if (typeof node === 'string') {
    const filled = fillText(node, slots);
    return filled.ok ? filled.value : node;
  }
  if (Array.isArray(node)) return node.map((child) => fillNode(child, slots));
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      const value = fillNode(item, slots);
      if (key === '__proto__')
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      else out[key] = value;
    }
    return out;
  }
  return node;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A tool expectation from a uses_tool relation or a recovery tool, its inputs filled. */
export function toolExpect(
  label: string,
  count: ToolExpect['count'] | undefined,
  input: Record<string, Assertion> | undefined,
  slots: Slots,
): Filled<ToolExpect> {
  const filled = input === undefined ? undefined : fillValue(input, slots);
  if (filled && !filled.ok) return filled;
  return {
    ok: true,
    value: {
      label,
      count: count ?? 1,
      ...(filled?.ok ? { input: filled.value, input_closed: true } : {}),
    },
  };
}

/** An end state with its slots filled. */
export function endState(
  template: NonNullable<PathRelation['end_state']>,
  slots: Slots,
): Filled<EndStateSpec> {
  const filled = fillValue(template.expect, slots);
  if (!filled.ok) return filled;
  return { ok: true, value: { source: template.source, mode: template.mode, expect: filled.value } };
}

/** Whether a phrase fits a context and its slots can all be filled. */
export function phraseFits(phrase: ProposalPhrase, context: Context, slots: Slots): boolean {
  if (!matches(phrase.when, context)) return false;
  const all = { ...slots, ...(phrase.binds ?? {}) };
  // Eligibility needs only bound slots, not the rendered string that the chosen phrase will use.
  return slotNames(phrase.text).every((name) => all[name] !== undefined);
}
