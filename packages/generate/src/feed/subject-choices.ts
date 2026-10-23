import type { SpanLabel } from './sources';
import type { LabelledClause } from './subjects';

export type SubjectCandidate = {
  id: string;
  subject: string;
  kind: 'numeric' | 'member' | 'boolean';
  unit?: string;
};

export type SubjectChoiceReader = (
  clause: LabelledClause,
  candidates: readonly SubjectCandidate[],
) => Promise<unknown>;

function candidateOf(label: SpanLabel | undefined): Omit<SubjectCandidate, 'id'> | undefined {
  if (label === undefined || label.kind === 'none' || typeof label.subject !== 'string') return undefined;
  return {
    subject: label.subject,
    kind: label.kind === 'range' ? 'numeric' : label.kind,
    ...('unit' in label && typeof label.unit === 'string' ? { unit: label.unit.trim().toLowerCase() } : {}),
  };
}

/**
 * Reconciles successive labelled batches with the reader's choice of an existing label id or `new`.
 * The catalogue deduplicates exact structured identities; only the reader can equate different identities.
 * Choices cannot change a clause's kind, unit, limits or comparator. No clause text is interpreted here.
 * Every clause gets its own choice, even when another clause received the same initial label.
 */
export function createSubjectReconciler(known: readonly SpanLabel[] = []) {
  const catalogue = new Map<string, SubjectCandidate>();
  const remember = (candidate: Omit<SubjectCandidate, 'id'>): SubjectCandidate => {
    const key = JSON.stringify(candidate);
    let entry = catalogue.get(key);
    if (entry === undefined) {
      entry = { id: `label-${catalogue.size + 1}`, ...candidate };
      catalogue.set(key, entry);
    }
    return entry;
  };
  for (const label of known) {
    const candidate = candidateOf(label);
    if (candidate !== undefined) remember(candidate);
  }
  return async <T extends LabelledClause>(
    clauses: readonly T[],
    choose: SubjectChoiceReader,
  ): Promise<T[]> => {
    const out: T[] = [];
    for (const clause of clauses) {
      const candidate = candidateOf(clause.label);
      if (candidate === undefined) {
        out.push(clause);
        continue;
      }
      const compatible = [...catalogue.values()].filter(
        (entry) => entry.kind === candidate.kind && (entry.unit ?? '') === (candidate.unit ?? ''),
      );
      // Hand the reader copies: it cannot mutate the catalogue or the original label.
      const choice = await choose(
        structuredClone(clause),
        compatible.map((entry) => ({ ...entry })),
      );
      const selected = compatible.find((entry) => entry.id === choice) ?? remember(candidate);
      out.push({ ...clause, label: { ...clause.label, subject: selected.subject } });
    }
    return out;
  };
}
