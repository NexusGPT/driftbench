import { canonicalJson, DeviationClass } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import {
  type Answer,
  AnswerConstraint,
  AnswerDimension,
  AnswerPhrase,
  AnswerRelation,
  AnswerValue,
  firstIssue,
  MAX_MODEL_QUOTE,
  MIN_MODEL_QUOTE,
  SECTION_KINDS,
  type Section,
} from './contract';
import {
  combinationKey,
  type Evidence,
  FLOW_DIMENSION,
  PENDING_STAGE,
  type ProposalConstraint,
  type ProposalDimension,
  type ProposalPhrase,
  type ProposalRelation,
  type ProposalValue,
  relationLabel,
  type When,
} from './proposal';
import { foldQuote, type QuoteIndex, shortQuote } from './quote';
import { proposeRole, SINGLE_KINDS } from './space';

/** The entries gathered so far: the code pre-pass first, then each section's accepted entries. */
export type Draft = {
  dimensions: ProposalDimension[];
  constraints: ProposalConstraint[];
  phrases: ProposalPhrase[];
  relations: ProposalRelation[];
};

/** An entry the extractor refused, with the reason. Refusals are reported, never dropped silently. */
export type Refusal = { section: Section; entry: string; reason: string };

export type Accepted = {
  /** How many values, constraints, phrases and relations entered the draft. */
  accepted: number;
  refusals: Refusal[];
  /** Entries already in the draft, skipped. */
  duplicates: string[];
  /** Constraints refused only because a value they name is not proposed yet; a later chunk may propose it. */
  deferred: Array<{ raw: unknown; entry: string }>;
};

/**
 * Checks each entry of a readable answer on its own and adds the good ones to the draft, unapproved. An
 * entry is refused when its shape is wrong, its kind does not belong to the section, its source is not one
 * of the sources, its quote is missing or not found in that source, or it points at a value that does not
 * exist.
 */
export function acceptAnswer(section: Section, answer: Answer, draft: Draft, quotes: QuoteIndex): Accepted {
  const result: Accepted = { accepted: 0, refusals: [], duplicates: [], deferred: [] };
  const refuse = (entry: string, reason: string): void => {
    result.refusals.push({ section, entry, reason });
  };
  const duplicate = (entry: string): void => {
    result.duplicates.push(`${section}: ${entry} is already proposed`);
  };
  const evidence = (source: string, quote: string): Evidence | string => {
    const folded = foldQuote(quote);
    if (folded === '') return 'the quote is missing: every entry quotes the source that justifies it';
    if (!quotes.has(source)) return `"${source}" is not one of the sources`;
    if (folded.length < MIN_MODEL_QUOTE) return 'the quote is too short to show where the entry comes from';
    if (quote.length > MAX_MODEL_QUOTE) {
      return `the quote is longer than ${MAX_MODEL_QUOTE} characters: quote the passage, not the file`;
    }
    if (!quotes.contains(source, quote)) return `the quote is not in ${source}: "${shortQuote(quote, 60)}"`;
    return { source, quote };
  };

  for (const [index, raw] of answer.dimensions.entries()) {
    const label = `dimension ${labelOf(raw, 'id') ?? `#${index + 1}`}`;
    if (section === 'phrases' || section === 'relations') {
      refuse(label, `the ${section} section proposes ${section} only`);
      continue;
    }
    const parsed = AnswerDimension.safeParse(raw);
    if (!parsed.success) {
      refuse(label, firstIssue(parsed.error));
      continue;
    }
    const dimension = parsed.data;
    const allowed = SECTION_KINDS[section];
    if (!allowed.includes(dimension.kind)) {
      refuse(
        label,
        `kind ${dimension.kind} does not belong to the ${section} section (${allowed.join(' or ')})`,
      );
      continue;
    }
    const existing = draft.dimensions.find((candidate) => candidate.id === dimension.id);
    if (existing && existing.kind !== dimension.kind) {
      refuse(label, `${dimension.id} already exists with the kind ${existing.kind}`);
      continue;
    }
    const single = SINGLE_KINDS.has(dimension.kind)
      ? draft.dimensions.find(
          (candidate) => candidate.kind === dimension.kind && candidate.id !== dimension.id,
        )
      : undefined;
    if (single) {
      refuse(label, `a map holds one ${dimension.kind} dimension: add the values to "${single.id}"`);
      continue;
    }
    const values: ProposalValue[] = [];
    const known = new Set(existing?.values.map((value) => value.id));
    for (const [position, rawValue] of dimension.values.entries()) {
      const valueLabel = `${dimension.id}/${labelOf(rawValue, 'id') ?? `#${position + 1}`}`;
      const value = AnswerValue.safeParse(rawValue);
      if (!value.success) {
        refuse(valueLabel, firstIssue(value.error));
        continue;
      }
      if (known.has(value.data.id)) {
        duplicate(valueLabel);
        continue;
      }
      const clash = valueClash(draft, dimension.id, dimension.kind, value.data.id);
      if (clash) {
        refuse(valueLabel, clash);
        continue;
      }
      const found = evidence(value.data.source, value.data.quote);
      if (typeof found === 'string') {
        refuse(valueLabel, found);
        continue;
      }
      const { source: _source, quote: _quote, ...rest } = value.data;
      known.add(value.data.id);
      values.push({ ...rest, evidence: found, produced_by: 'model' });
    }
    if (values.length === 0) continue;
    result.accepted += values.length;
    if (existing) existing.values.push(...values);
    else {
      draft.dimensions.push({
        id: dimension.id,
        title: dimension.title,
        kind: dimension.kind,
        role: dimension.role ?? proposeRole(draft.dimensions, dimension.kind, false),
        produced_by: 'model',
        approved: false,
        values,
      });
    }
  }

  const forbidden = new Set(draft.constraints.map((constraint) => combinationKey(constraint.forbid)));
  for (const [index, raw] of answer.constraints.entries()) {
    const label = `constraint #${index + 1}`;
    if (section === 'phrases' || section === 'relations') {
      refuse(label, `the ${section} section proposes ${section} only`);
      continue;
    }
    const parsed = AnswerConstraint.safeParse(raw);
    if (!parsed.success) {
      refuse(label, firstIssue(parsed.error));
      continue;
    }
    const constraint = parsed.data;
    const pairs = Object.entries(constraint.forbid);
    const named = `${label} (${pairs.map(([dimension, value]) => `${dimension}=${value}`).join(', ')})`;
    if (pairs.length < 2) {
      refuse(named, 'a constraint names values from at least two dimensions');
      continue;
    }
    const unknown = pairs.find(([dimension, value]) => !hasValue(draft, dimension, value));
    if (unknown) {
      refuse(named, `${unknown[0]}=${unknown[1]} is not a proposed value`);
      result.deferred.push({ raw, entry: named });
      continue;
    }
    const key = combinationKey(constraint.forbid);
    if (forbidden.has(key)) {
      duplicate(named);
      continue;
    }
    const found = evidence(constraint.source, constraint.quote);
    if (typeof found === 'string') {
      refuse(named, found);
      continue;
    }
    forbidden.add(key);
    draft.constraints.push({
      forbid: constraint.forbid,
      reason: constraint.reason,
      evidence: found,
      produced_by: 'model',
      approved: false,
    });
    result.accepted++;
  }

  const phrased = new Set(draft.phrases.map(phraseKey));
  for (const [index, raw] of answer.phrases.entries()) {
    const label = `phrase #${index + 1}`;
    if (section !== 'phrases') {
      refuse(label, 'phrases come from the phrases section');
      continue;
    }
    const parsed = AnswerPhrase.safeParse(raw);
    if (!parsed.success) {
      refuse(label, firstIssue(parsed.error));
      continue;
    }
    const phrase = parsed.data;
    const named = `${label} (${phrase.dimension}/${phrase.value})`;
    if (!hasValue(draft, phrase.dimension, phrase.value)) {
      refuse(named, `${phrase.dimension}/${phrase.value} is not a proposed value`);
      continue;
    }
    if ((phrase.source === undefined) !== (phrase.quote === undefined)) {
      refuse(named, 'a phrase gives both source and quote, or neither');
      continue;
    }
    const badWhen = phrase.when ? unknownWhen(draft, phrase.when) : undefined;
    if (badWhen) {
      refuse(named, badWhen);
      continue;
    }
    let found: Evidence | undefined;
    if (phrase.source !== undefined && phrase.quote !== undefined) {
      const checked = evidence(phrase.source, phrase.quote);
      if (typeof checked === 'string') {
        refuse(named, checked);
        continue;
      }
      found = checked;
    }
    const entry: ProposalPhrase = {
      dimension: phrase.dimension,
      value: phrase.value,
      text: phrase.text,
      lang: phrase.lang,
      ...(phrase.when ? { when: phrase.when } : {}),
      ...(phrase.binds ? { binds: phrase.binds } : {}),
      ...(found ? { evidence: found } : {}),
      produced_by: 'model',
      approved: false,
    };
    const key = phraseKey(entry);
    if (phrased.has(key)) {
      duplicate(named);
      continue;
    }
    phrased.add(key);
    draft.phrases.push(entry);
    result.accepted++;
  }

  const related = new Set(draft.relations.map(relationKey));
  for (const [index, raw] of answer.relations.entries()) {
    const label = `relation #${index + 1}`;
    if (section !== 'relations') {
      refuse(label, 'relations come from the relations section');
      continue;
    }
    const parsed = AnswerRelation.safeParse(raw);
    if (!parsed.success) {
      refuse(label, firstIssue(parsed.error));
      continue;
    }
    const { source, quote, ...body } = parsed.data;
    const relation = {
      ...body,
      evidence: { source, quote },
      produced_by: 'model',
      approved: false,
    } as ProposalRelation;
    const named = `${label} (${relationLabel(relation)})`;
    const unknown = unknownInRelation(draft, relation);
    if (unknown) {
      refuse(named, unknown);
      continue;
    }
    const found = evidence(source, quote);
    if (typeof found === 'string') {
      refuse(named, found);
      continue;
    }
    relation.evidence = found;
    const key = relationKey(relation);
    if (related.has(key)) {
      duplicate(named);
      continue;
    }
    related.add(key);
    draft.relations.push(relation);
    result.accepted++;
  }

  return result;
}

/** Equal for relations that say the same thing, whoever proposed them and on whatever quote. */
export function relationKey(relation: ProposalRelation): string {
  const { evidence: _evidence, produced_by: _by, approved: _approved, ...body } = relation;
  return relation.kind === 'path' ? `path:${relation.id}` : canonicalJson(body);
}

/** Why a `when` names something the draft does not hold, or undefined. */
function unknownWhen(draft: Draft, when: When): string | undefined {
  for (const [dimension, values] of Object.entries(when)) {
    for (const value of values) {
      if (!hasValue(draft, dimension, value))
        return `when names ${dimension}=${value}, which is not a proposed value`;
    }
  }
  return undefined;
}

/** Why a relation names a value, stage, flow or class the draft does not hold, or undefined. */
function unknownInRelation(draft: Draft, relation: ProposalRelation): string | undefined {
  const stages = new Set(
    draft.dimensions.find((dimension) => dimension.kind === 'stage')?.values.map((value) => value.id),
  );
  const stage = (id: string) => (stages.has(id) ? undefined : `${id} is not a proposed stage`);
  const value = (dimension: string, id: string) =>
    hasValue(draft, dimension, id) ? undefined : `${dimension}=${id} is not a proposed value`;
  const first = (...found: Array<string | undefined>) => found.find((entry) => entry !== undefined);
  switch (relation.kind) {
    case 'path':
      return first(
        value(FLOW_DIMENSION, relation.flow),
        ...relation.stages.map(stage),
        ...(relation.behaviours ?? []).map((id) =>
          draft.dimensions.some(
            (dimension) =>
              dimension.kind === 'behaviour' && dimension.values.some((entry) => entry.id === id),
          )
            ? undefined
            : `${id} is not a proposed behaviour`,
        ),
        relation.when ? unknownWhen(draft, relation.when) : undefined,
      );
    case 'uses_tool':
    case 'states':
      return first(
        value(relation.subject.dimension, relation.subject.value),
        stage(relation.stage),
        relation.to === undefined ? undefined : stage(relation.to),
        relation.when ? unknownWhen(draft, relation.when) : undefined,
      );
    case 'binds':
    case 'reply_language':
    case 'reply_text':
    case 'route':
      return value(relation.subject.dimension, relation.subject.value);
    case 'tool_order':
    case 'reply_count':
      return undefined;
    case 'recovery': {
      const deviation = draft.dimensions.find((dimension) => dimension.kind === 'deviation');
      return first(
        deviation?.values.some((entry) => entry.id === relation.class)
          ? undefined
          : `${relation.class} is not a proposed deviation class`,
        ...relation.flows.map((flow) => value(FLOW_DIMENSION, flow)),
        ...(relation.at ?? []).map(stage),
        relation.stage_after === undefined || relation.stage_after === PENDING_STAGE
          ? undefined
          : stage(relation.stage_after),
      );
    }
    case 'task_family': {
      const deviation = draft.dimensions.find((dimension) => dimension.kind === 'deviation');
      return first(
        value(FLOW_DIMENSION, relation.flow),
        ...relation.stages.map(stage),
        relation.holds ? unknownWhen(draft, relation.holds) : undefined,
        ...(relation.deviations ?? []).map((cls) =>
          deviation?.values.some((entry) => entry.id === cls)
            ? undefined
            : `${cls} is not a proposed deviation class`,
        ),
      );
    }
  }
}

/**
 * Why a value id cannot join a dimension of this kind, by the space map's rules: `none` is reserved, a
 * deviation value is a deviation class, and a spec names a behaviour, persona, data or task value without
 * its dimension, so the id is unique across the dimensions of that kind.
 */
function valueClash(draft: Draft, dimension: string, kind: string, id: string): string | undefined {
  if (id === NONE) return `"${NONE}" is reserved: code adds it where a dimension needs it`;
  if (kind === 'deviation' && !DeviationClass.safeParse(id).success) {
    return `"${id}" is not a deviation class: use D1_off_topic to D12_prompt_extraction`;
  }
  if (kind === 'stage' || kind === 'deviation' || kind === 'channel') return undefined;
  const owner = draft.dimensions.find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.id !== dimension &&
      candidate.values.some((value) => value.id === id),
  );
  return owner
    ? `"${id}" is already a value of ${owner.id}: a spec names a ${kind} value without its dimension, so the id must be unique`
    : undefined;
}

function hasValue(draft: Draft, dimension: string, value: string): boolean {
  return draft.dimensions.some(
    (candidate) => candidate.id === dimension && candidate.values.some((known) => known.id === value),
  );
}

function phraseKey(phrase: Pick<ProposalPhrase, 'dimension' | 'value' | 'lang' | 'text'>): string {
  return JSON.stringify([phrase.dimension, phrase.value, phrase.lang, phrase.text.trim()]);
}

function labelOf(raw: unknown, key: string): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
