import { describe, expect, it } from 'vitest';
import { extractFinalAnswer, referenceConsensus } from '../src/answer-extraction';

describe('grounded final answer extraction', () => {
  it('takes the final explicitly marked answer and handles nested boxes', () => {
    const response = 'Work: \\boxed{3}. Correction: final answer: \\boxed{\\frac{1}{2}}';
    const answer = extractFinalAnswer(response);
    expect(answer?.text).toBe('\\frac{1}{2}');
    expect(response.slice(answer?.start, answer?.end)).toBe(answer?.quote);
  });
  it('does not infer an answer from the last unmarked paragraph', () => {
    expect(extractFinalAnswer('This is a long explanation with no explicit final answer.')).toBeUndefined();
  });
  it.each([':', '='])('copies the last Final answer is%s marker literally', (separator) => {
    const response = `Final answer: earlier\nCorrection. Final answer is${separator}  (C) Keep 0.010 kg.`;
    const answer = extractFinalAnswer(response);
    expect(answer?.text).toBe('(C) Keep 0.010 kg.');
    expect(response.slice(answer?.start, answer?.end)).toBe(answer?.quote);
  });
});

describe('strict reference agreement', () => {
  it('needs agreement over all attempts, missing solves included', () => {
    expect(referenceConsensus(['1', '1', undefined, '2', undefined]).reference).toBeUndefined();
    expect(referenceConsensus(['1', '1', '1', '1', undefined]).reference).toBe('1');
  });
  it('preserves decimal points and treats ties as no reference', () => {
    expect(referenceConsensus(['2.5', '25', '25', '2.5']).reference).toBeUndefined();
  });
});
