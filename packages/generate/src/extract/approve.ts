import { isMap, isPair, isScalar, isSeq, parseDocument, visit } from 'yaml';
import { type Proposal, type ProposalIssue, parseProposalText, relationLabel } from './proposal';

/** A decision a person has not made yet, including a numeric runtime range. */
export type PendingEntry = {
  kind: 'dimension' | 'constraint' | 'phrase' | 'relation' | 'numeric_setting';
  /** Where it sits in the file, such as `dimensions.3` or `constraints.0`. */
  path: string;
  /** What it is: the dimension id, `behaviour=B-001 + channel=whatsapp`, or the phrase's value. */
  label: string;
  /** For a dimension, its kind, role, origin, value count and title; the reason; or the phrase text. */
  detail: string;
  /** The evidence, when the entry has one. A dimension's evidence is on its values. */
  source?: string;
  quote?: string;
};

/**
 * Every decision left, in file order: dimensions, constraints, phrases, then relations. A dimension is pending
 * while its own flag is false, whatever its values' overrides say: the listing names those overrides.
 */
export function pendingEntries(proposal: Proposal): PendingEntry[] {
  const pending: PendingEntry[] = [];
  proposal.dimensions.forEach((dimension, d) => {
    if (dimension.approved) return;
    const overrides = dimension.values.filter((value) => value.approved !== undefined);
    const count = `${dimension.values.length} value${dimension.values.length === 1 ? '' : 's'}`;
    const set = overrides.length > 0 ? `, ${overrides.length} set on their own` : '';
    pending.push({
      kind: 'dimension',
      path: `dimensions.${d}`,
      label: dimension.id,
      detail: `${dimension.kind} ${dimension.role}, by ${dimension.produced_by}, ${count}${set}: ${dimension.title}`,
    });
  });
  proposal.constraints.forEach((constraint, c) => {
    if (constraint.approved) return;
    pending.push({
      kind: 'constraint',
      path: `constraints.${c}`,
      label: Object.entries(constraint.forbid)
        .map(([dimension, value]) => `${dimension}=${value}`)
        .join(' + '),
      detail: constraint.reason,
      source: constraint.evidence.source,
      quote: constraint.evidence.quote,
    });
  });
  proposal.phrases.forEach((phrase, p) => {
    if (phrase.approved) return;
    pending.push({
      kind: 'phrase',
      path: `phrases.${p}`,
      label: `${phrase.dimension}/${phrase.value}`,
      detail: `"${phrase.text}" (${phrase.lang})`,
      ...(phrase.evidence ? { source: phrase.evidence.source, quote: phrase.evidence.quote } : {}),
    });
  });
  (proposal.relations ?? []).forEach((relation, r) => {
    if (relation.approved) return;
    pending.push({
      kind: 'relation',
      path: `relations.${r}`,
      label: relation.kind,
      detail: relationLabel(relation),
      source: relation.evidence.source,
      quote: relation.evidence.quote,
    });
  });
  (proposal.numeric_settings ?? []).forEach((setting, index) => {
    if (setting.approved) return;
    pending.push({
      kind: 'numeric_setting',
      path: `numeric_settings.${index}`,
      label: setting.id,
      detail: `${setting.min} to ${setting.max}${setting.integer ? ', integer' : ''}${setting.unit ? ` ${setting.unit}` : ''}`,
      source: setting.evidence.source,
      quote: setting.evidence.quote,
    });
  });
  return pending;
}

export type ApproveDimensions =
  | { ok: true; text: string; approved: string[]; already: string[] }
  | { ok: false; errors: ProposalIssue[] };

/**
 * Sets `approved: true` on the named dimensions of a valid proposal; their values inherit it, except a value
 * that set its own flag. Comments, order and layout stay as they were. An unknown id approves nothing.
 */
export function approveDimensions(text: string, ids: readonly string[]): ApproveDimensions {
  const before = parseProposalText(text);
  if (!before.ok) return before;
  const known = new Set(before.proposal.dimensions.map((dimension) => dimension.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: unknown.map((id) => ({
        code: 'PROPOSAL_UNKNOWN_DIMENSION',
        path: '',
        message: `dimension "${id}" is not in the proposal`,
      })),
    };
  }
  const doc = parseDocument(text, { uniqueKeys: true });
  const approved: string[] = [];
  const already: string[] = [];
  const dimensions = doc.get('dimensions', true);
  if (isSeq(dimensions)) {
    for (const item of dimensions.items) {
      if (!isMap(item)) continue;
      const id = item.get('id');
      if (typeof id !== 'string' || !ids.includes(id)) continue;
      if (item.get('approved') === true) already.push(id);
      else {
        item.set('approved', true);
        approved.push(id);
      }
    }
  }
  const next = doc.toString({ lineWidth: 0 });
  const after = parseProposalText(next);
  if (!after.ok) return after;
  return { ok: true, text: next, approved, already };
}

export type ApproveAll =
  | { ok: true; text: string; approved: number; already: number }
  | { ok: false; errors: ProposalIssue[] };

/**
 * Sets `approved: true` on every flag of a valid proposal (dimensions, value overrides, constraints,
 * phrases and relations) and returns the new text. Comments, order and layout stay as they were: only the flags change.
 * `approved` counts the flags flipped, `already` the ones that were true before.
 */
export function approveAll(text: string): ApproveAll {
  const before = parseProposalText(text);
  if (!before.ok) return before;
  const doc = parseDocument(text, { uniqueKeys: true });
  let approved = 0;
  let already = 0;
  visit(doc, {
    Pair(_, pair) {
      if (!isPair(pair) || !isScalar(pair.key) || pair.key.value !== 'approved' || !isScalar(pair.value))
        return;
      if (pair.value.value === true) already++;
      if (pair.value.value === false) {
        pair.value.value = true;
        approved++;
      }
    },
  });
  const next = doc.toString({ lineWidth: 0 });
  const after = parseProposalText(next);
  if (!after.ok) return after;
  return { ok: true, text: next, approved, already };
}
