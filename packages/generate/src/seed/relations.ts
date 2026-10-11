import type { Assertion, EndStateSpec, GuardExpect, ToolExpect } from '@driftbench/core';
import { isPlainObject } from '@driftbench/core';
import {
  type PathRelation,
  PENDING_STAGE,
  type Proposal,
  type ProposalPhrase,
  type RecoveryRelation,
  type RecoveryTool,
  type Slots,
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
  /** Slot values by `dimension=value`. */
  binds: ReadonlyMap<string, Slots>;
  recoveries: RecoveryRelation[];
  /** The language every reply is in, as a spec writes it (EN); undefined when the map fixes none. */
  replyLanguage: string | undefined;
};

export const EMPTY_RELATIONS: Relations = {
  paths: [],
  usesTools: [],
  binds: new Map(),
  recoveries: [],
  replyLanguage: undefined,
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
  return {
    paths,
    usesTools,
    binds,
    recoveries,
    replyLanguage: language?.kind === 'reply_language' ? language.lang.toUpperCase() : undefined,
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

/** The slots a text reads. */
export function slotsIn(text: string): string[] {
  return [...text.matchAll(SLOT)].map((match) => match[1] as string);
}

/** The slots every string of a value reads, nested values included. */
export function slotsOf(value: unknown): string[] {
  if (typeof value === 'string') return slotsIn(value);
  if (Array.isArray(value)) return value.flatMap(slotsOf);
  if (isPlainObject(value)) return Object.values(value).flatMap(slotsOf);
  return [];
}

export type Filled<T> = { ok: true; value: T } | { ok: false; missing: string[] };

/** A text with each `{slot}` replaced; `literal` writes a value as a literal regular expression. */
export function fillText(text: string, slots: Slots, literal = false): Filled<string> {
  const missing = slotsIn(text).filter((name) => slots[name] === undefined);
  if (missing.length > 0) return { ok: false, missing: [...new Set(missing)] };
  return {
    ok: true,
    value: text.replace(SLOT, (_all, name: string) => {
      const value = slots[name] as string;
      return literal ? escapeRegExp(value) : value;
    }),
  };
}

/** A value with every `{slot}` in its strings replaced. */
export function fillValue<T>(value: T, slots: Slots): Filled<T> {
  const missing = [...new Set(slotsOf(value).filter((name) => slots[name] === undefined))];
  if (missing.length > 0) return { ok: false, missing };
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const filled = fillText(node, slots);
      return filled.ok ? filled.value : node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isPlainObject(node))
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    return node;
  };
  return { ok: true, value: walk(value) as T };
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
      ...(filled?.ok ? { input: filled.value } : {}),
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
  return fillText(phrase.text, all).ok;
}
