import { answerKey } from './answer-key';
import { jsonObjects } from './contestants';

export { answerKey } from './answer-key';
export type GateInput = {
  question: string;
  a: string;
  b: string;
  reference?: string;
  ab: readonly string[];
  ba: readonly string[];
};
export function cascadeReasons(input: GateInput, threshold = 0.75, conservativeAlignment = false): string[] {
  const reasons: string[] = [];
  const reference = answerKey(input.reference ?? '', true),
    a = answerKey(input.a),
    b = answerKey(input.b);
  if (reference && a && b && reference !== a && reference !== b)
    reasons.push('reference disagrees with both final answers');
  if (conservativeAlignment && (!reference || !a || !b))
    reasons.push('low answer-alignment confidence: extraction is incomplete');
  const categories: string[] = [];
  for (const [order, texts] of [
    ['AB', input.ab],
    ['BA', input.ba],
  ] as const) {
    for (const text of texts) {
      const j = jsonObjects(text)
        .filter((j) => 'outcome' in j)
        .at(-1);
      const outcome = j?.outcome;
      const category =
        outcome === 'pass'
          ? order === 'AB'
            ? 'A'
            : 'B'
          : outcome === 'fail'
            ? order === 'AB'
              ? 'B'
              : 'A'
            : 'tie';
      categories.push(category);
      const score = j?.score;
      if (
        typeof score === 'number' &&
        score >= 0 &&
        score <= 1 &&
        (outcome === 'pass' ? score : outcome === 'fail' ? 1 - score : 0) <= threshold
      )
        reasons.push('low recorded verdict confidence');
    }
  }
  if (categories.length !== 6 || categories.includes('tie'))
    reasons.push('low verdict confidence: missing or inconclusive base categories');
  if (new Set(categories).size > 1) reasons.push('base categories split across samples or orders');
  if (/cannot determine|uncertain|unsure|ambiguous|best guess/i.test(input.reference ?? ''))
    reasons.push('low reference confidence: explicit uncertainty');
  return [...new Set(reasons)];
}
