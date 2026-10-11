import { isPair, isScalar, parseDocument, visit } from 'yaml';
import { type Proposal, type ProposalIssue, parseProposalText } from './proposal';

/** An entry a person has not approved yet. */
export type PendingEntry = {
  kind: 'value' | 'constraint' | 'phrase';
  /** Where it sits in the file, such as `dimensions.0.values.3`. */
  path: string;
  /** What it is: `stage/offer`, `behaviour=B-001 + channel=whatsapp`, or the phrase's value. */
  label: string;
  /** The title, the reason, or the phrase text. */
  detail: string;
  /** The evidence, when the entry has one. */
  source?: string;
  quote?: string;
};

/** Every unapproved entry, in file order: values, then constraints, then phrases. */
export function pendingEntries(proposal: Proposal): PendingEntry[] {
  const pending: PendingEntry[] = [];
  proposal.dimensions.forEach((dimension, d) => {
    dimension.values.forEach((value, v) => {
      if (value.approved) return;
      pending.push({
        kind: 'value',
        path: `dimensions.${d}.values.${v}`,
        label: `${dimension.id}/${value.id}`,
        detail: value.title,
        source: value.evidence.source,
        quote: value.evidence.quote,
      });
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
  return pending;
}

export type ApproveAll =
  | { ok: true; text: string; approved: number; already: number }
  | { ok: false; errors: ProposalIssue[] };

/**
 * Sets `approved: true` on every entry of a valid proposal and returns the new text. Comments, order and
 * layout stay as they were: only the flags change. `approved` counts the flags flipped, `already` the ones
 * that were true before.
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
