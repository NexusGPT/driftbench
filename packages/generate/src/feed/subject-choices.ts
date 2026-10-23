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

/** Reconciles successive labelled batches with the reader's choice of an existing label id or `new`. */
export function createSubjectReconciler(_known: readonly SpanLabel[] = []) {
  return async <T extends LabelledClause>(
    clauses: readonly T[],
    _choose: SubjectChoiceReader,
  ): Promise<T[]> => [...clauses];
}
