import { DeviationClass } from '@driftbench/core';
import { NONE } from '@driftbench/space';
import {
  type Answer,
  AnswerConstraint,
  AnswerDimension,
  AnswerPhrase,
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
  type ProposalConstraint,
  type ProposalDimension,
  type ProposalPhrase,
  type ProposalValue,
} from './proposal';
import { foldQuote, type QuoteIndex, shortQuote } from './quote';
import { proposeRole, SINGLE_KINDS } from './space';

/** The entries gathered so far: the code pre-pass first, then each section's accepted entries. */
export type Draft = {
  dimensions: ProposalDimension[];
  constraints: ProposalConstraint[];
  phrases: ProposalPhrase[];
};

/** An entry the extractor refused, with the reason. Refusals are reported, never dropped silently. */
export type Refusal = { section: Section; entry: string; reason: string };

export type Accepted = {
  /** How many values, constraints and phrases entered the draft. */
  accepted: number;
  refusals: Refusal[];
  /** Entries already in the draft, skipped. */
  duplicates: string[];
};

/**
 * Checks each entry of a readable answer on its own and adds the good ones to the draft, unapproved. An
 * entry is refused when its shape is wrong, its kind does not belong to the section, its source is not one
 * of the sources, its quote is missing or not found in that source, or it points at a value that does not
 * exist.
 */
export function acceptAnswer(section: Section, answer: Answer, draft: Draft, quotes: QuoteIndex): Accepted {
  const result: Accepted = { accepted: 0, refusals: [], duplicates: [] };
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
    if (section === 'phrases') {
      refuse(label, 'the phrases section proposes phrases only');
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
      known.add(value.data.id);
      values.push({ id: value.data.id, title: value.data.title, evidence: found, produced_by: 'model' });
    }
    if (values.length === 0) continue;
    result.accepted += values.length;
    if (existing) existing.values.push(...values);
    else {
      draft.dimensions.push({
        id: dimension.id,
        title: dimension.title,
        kind: dimension.kind,
        role: proposeRole(draft.dimensions, dimension.kind, false),
        produced_by: 'model',
        approved: false,
        values,
      });
    }
  }

  const forbidden = new Set(draft.constraints.map((constraint) => combinationKey(constraint.forbid)));
  for (const [index, raw] of answer.constraints.entries()) {
    const label = `constraint #${index + 1}`;
    if (section === 'phrases') {
      refuse(label, 'the phrases section proposes phrases only');
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

  return result;
}

/**
 * Why a value id cannot join a dimension of this kind, by the space map's rules: `none` is reserved, a
 * deviation value is a deviation class, and a spec names a behaviour, persona, data or task value without
 * its dimension, so the id is unique across the dimensions of that kind.
 */
function valueClash(draft: Draft, dimension: string, kind: string, id: string): string | undefined {
  if (id === NONE) return `"${NONE}" is reserved: code adds it where a dimension needs it`;
  if (kind === 'deviation' && !DeviationClass.safeParse(id).success) {
    return `"${id}" is not a deviation class: use D1_off_topic to D10_return`;
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
