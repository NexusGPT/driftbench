import type { ConditionJudge } from '../../../packages/generate/src/feed/judge-reader';

/** Frozen before the blind run; this judge never feeds an answer back to the reader. */
export async function equivalentTitle(judge: ConditionJudge, proposed: string, reference: string) {
  const result = await judge.judge({
    criterion: {
      name: 'title_equivalence',
      rubric: 'Do the two condition titles express the same triggering situation?',
      pass: 'The titles describe the same entity, actor, event, polarity, numeric boundary, strictness and timing. Equivalent wording counts.',
      fail: 'The titles differ in meaning, including a broader or narrower situation, a changed entity, a changed number, polarity or timing.',
      scope: 'conversation',
    },
    transcript: [{ role: 'user', text: JSON.stringify({ proposed, reference }) }],
  });
  const probability = result.answer.score;
  if (
    result.unparsed ||
    typeof probability !== 'number' ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  )
    return undefined;
  return probability >= 0.5;
}
