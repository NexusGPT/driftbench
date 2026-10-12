import { describe, expect, it } from 'vitest';
import { answerKey, cascadeReasons } from '../src/cascade';
import { cascadeConfig } from '../src/cascade-run';
import { contestantById } from '../src/contestants';

const pass = JSON.stringify({ outcome: 'pass', score: 0.9 });
const fail = JSON.stringify({ outcome: 'fail', score: 0.1 });
const confident = {
  question: 'Choose the correct option.',
  a: 'AAAAA',
  b: 'BBBBB',
  reference: 'Final answer: A',
  ab: [pass, pass, pass],
  ba: [fail, fail, fail],
};
describe('label-blind reference3 escalation gate', () => {
  it('records global threshold variants explicitly and rejects invalid confidence', () => {
    expect(cascadeConfig('driftbench-reference3-tools-cascade')?.confidenceThreshold).toBe(0.75);
    expect(cascadeConfig('driftbench-reference3-tools-format-cascade-85')?.confidenceThreshold).toBe(0.85);
    expect(cascadeConfig('driftbench-reference3')).toBeUndefined();
    expect(() => cascadeConfig('driftbench-reference3-tools-cascade-101')).toThrow('Invalid');
  });
  it('retains an aligned, consistent, high-confidence base decision', () => {
    expect(cascadeReasons(confident)).toEqual([]);
  });
  it('escalates reference disagreement, normalized category splits and low confidence', () => {
    expect(cascadeReasons({ ...confident, reference: 'Final answer: C' })).toContain(
      'reference disagrees with both final answers',
    );
    expect(cascadeReasons({ ...confident, ba: [pass, fail, fail] })).toContain(
      'base categories split across samples or orders',
    );
    expect(
      cascadeReasons({ ...confident, ab: [JSON.stringify({ outcome: 'pass', score: 0.6 }), pass, pass] }),
    ).toContain('low recorded verdict confidence');
  });
  it('conservatively escalates unsupported alignment and never reads a desired label', () => {
    const input = { ...confident, reference: 'A full program with no final answer', label: 'A' };
    expect(cascadeReasons(input, 0.75, true)).toContain(
      'low answer-alignment confidence: extraction is incomplete',
    );
    expect(cascadeReasons(input)).toEqual([]);
    const changedLabel = { ...input, label: 'B' };
    expect(cascadeReasons(changedLabel)).toEqual(cascadeReasons(input));
  });
  it('normalizes numeric values without merging different fractions or decimals', () => {
    expect(answerKey('Final answer: 2/4', true)).toBe(answerKey('\\boxed{0.5}'));
    expect(answerKey('Final answer: 2/3', true)).not.toBe(answerKey('Final answer: 2/4', true));
    expect(answerKey('Final answer: 2.5', true)).not.toBe(answerKey('Final answer: 25', true));
  });
  it('keeps reference3 data and reasoning while replacing its output contract with named winners', () => {
    const input = {
      question: 'What is 2+2?',
      a: '4',
      b: '5',
      criterion: 'The final answer is correct.',
      reference: 'Final answer: 4',
    };
    const base = contestantById('driftbench-reference3').pair?.(input);
    const tools = contestantById('driftbench-reference3-tools').pair?.(input);
    expect(tools?.user).toBe(base?.user);
    expect(tools?.system).toContain('reason step by step in plain text');
    expect(tools?.system).toContain('"winner":"A or B or tie"');
    expect(tools?.system).not.toContain('"outcome": "pass"');
    expect(contestantById('driftbench-reference3-tools').samples).toBe(3);
  });
  it('adds format compliance to the unchanged base only for equivalent extracted finals', () => {
    const base = contestantById('driftbench-reference3');
    const formatted = contestantById('driftbench-reference3-format');
    const input = {
      question: 'Return the answer in JSON.',
      a: 'Final answer: 4',
      b: 'Final answer: 5',
      criterion: 'Correctness',
    };
    expect(formatted.pair?.(input)).toEqual(base.pair?.(input));
    const decision = '{"outcome":"pass","score":0.9,"reasoning":"A is correct"}';
    expect(formatted.parsePair?.(decision, { ...input, format: { a: false, b: true } })).toBe('A');
    expect(
      formatted.parsePair?.(decision, { ...input, b: 'Final answer: 4', format: { a: false, b: true } }),
    ).toBe('B');
    expect(
      formatted.parsePair?.(decision, { ...input, b: 'Final answer: 4', format: { a: null, b: true } }),
    ).toBe('A');
  });
});
