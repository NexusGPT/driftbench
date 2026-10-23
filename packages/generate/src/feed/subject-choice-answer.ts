import type { SubjectCandidate } from './subject-choices';

export type SubjectChoiceResponse = { text: string; stopReason?: string };
export type SubjectChoiceAnswer =
  | { ok: true; choice: string }
  | { ok: false; code: 'truncated' | 'malformed' | 'invalid-choice' };

/** Decode only a complete JSON string in the offered enum: failure is never the choice `new`. */
export function readSubjectChoice(
  response: SubjectChoiceResponse,
  candidates: readonly SubjectCandidate[],
): SubjectChoiceAnswer {
  if (response.stopReason === 'max_tokens') return { ok: false, code: 'truncated' };
  let choice: unknown;
  try {
    choice = JSON.parse(response.text);
  } catch {
    return { ok: false, code: 'malformed' };
  }
  return typeof choice === 'string' &&
    (choice === 'new' || candidates.some((candidate) => candidate.id === choice))
    ? { ok: true, choice }
    : { ok: false, code: 'invalid-choice' };
}

/**
 * The answer schema is the finite enum of candidate ids plus `new`, encoded as a JSON string. Its longest UTF-8
 * encoding bounds the visible answer at one token per byte. Add 1024 tokens of margin (the medium reasoning
 * allowance in judges/src/contract.ts): the provider's output limit can include thinking before the short answer.
 * This is transport room, not permission to emit prose; readSubjectChoice still accepts only the enum.
 */
export function subjectChoiceMaxTokens(candidates: readonly SubjectCandidate[]): number {
  return (
    Math.max(
      ...['new', ...candidates.map((candidate) => candidate.id)].map((id) =>
        Buffer.byteLength(JSON.stringify(id), 'utf8'),
      ),
    ) + 1024
  );
}

type FailureCode = Extract<SubjectChoiceAnswer, { ok: false }>['code'];
export type SubjectChoiceResult =
  | { ok: true; choice: string; errors: FailureCode[] }
  | { ok: false; code: 'subject-choice-failed'; errors: FailureCode[] };

/** One retry after a failed read; the caller records every failure, including one recovered by that retry. */
export async function requestSubjectChoice(
  candidates: readonly SubjectCandidate[],
  request: (previousFailure?: FailureCode) => Promise<SubjectChoiceResponse>,
): Promise<SubjectChoiceResult> {
  const errors: FailureCode[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = readSubjectChoice(await request(errors.at(-1)), candidates);
    if (answer.ok) return { ...answer, errors };
    errors.push(answer.code);
  }
  return { ok: false, code: 'subject-choice-failed', errors };
}
