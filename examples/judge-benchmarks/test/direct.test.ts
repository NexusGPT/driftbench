import { describe, expect, it } from 'vitest';
import {
  parseCorrectnessLedger,
  parseDirectWinner,
  parseFactWinner,
  parseFormatLedger,
} from '../src/contestants';

describe('direct winner and code-computed verdict', () => {
  it('preserves a reasoned equal-correctness choice but computes unequal factual verdicts', () => {
    expect(parseFactWinner('{"a_correct":false,"b_correct":true,"winner":"A"}')).toBe('B');
    expect(parseFactWinner('{"a_correct":true,"b_correct":false,"winner":"B"}')).toBe('A');
    expect(parseFactWinner('{"a_correct":true,"b_correct":true,"winner":"B"}')).toBe('B');
    expect(parseFactWinner('{"a_correct":false,"b_correct":false,"winner":"A"}')).toBe('tie');
    expect(parseFactWinner('{"a_correct":null,"b_correct":true,"winner":"B"}')).toBe('B');
    expect(parseFactWinner('{"a_correct":"true","b_correct":false,"winner":"B"}')).toBe('B');
  });
  it('uses a validated general format signal only after equally correct final answers', () => {
    const text = '{"a_correct":true,"b_correct":true,"winner":"A"}';
    const context = { question: 'Return JSON only.', a: '{}', b: 'not JSON', format: { a: true, b: false } };
    expect(parseFormatLedger(text, context)).toBe('A');
    expect(parseFormatLedger(text, { ...context, format: { a: false, b: true } })).toBe('B');
    expect(parseFormatLedger(text, { ...context, format: { a: null, b: true } })).toBe('tie');
    expect(parseFormatLedger(text, { question: 'Choose the correct option.', a: 'CCCC', b: 'CCCCC' })).toBe(
      'tie',
    );
    expect(parseFormatLedger('{"a_correct":false,"b_correct":true,"winner":"A"}', context)).toBe('B');
  });
  it('reads B directly even when a stray pass outcome is present', () => {
    expect(parseDirectWinner('{"reasoning":"B wins", "outcome":"pass", "winner":"B"}')).toBe('B');
    expect(parseDirectWinner('{"winner":"A"}')).toBe('A');
    expect(parseDirectWinner('{"winner":"tie"}')).toBe('tie');
    expect(parseDirectWinner('{"winner":1}')).toBe('tie');
  });
  it('computes the winner from factual checks despite a contradictory named winner', () => {
    expect(parseCorrectnessLedger('{"a_correct":false,"b_correct":true,"winner":"A"}')).toBe('B');
    expect(parseCorrectnessLedger('{"a_correct":true,"b_correct":false,"winner":"B"}')).toBe('A');
    expect(parseCorrectnessLedger('{"a_correct":true,"b_correct":true,"winner":"A"}')).toBe('tie');
    expect(parseCorrectnessLedger('{"a_correct":false,"b_correct":false,"winner":"B"}')).toBe('tie');
  });
  it('does not coerce strings to factual verdicts and uses direct comparison for uncertainty', () => {
    expect(parseCorrectnessLedger('{"a_correct":"true","b_correct":false,"winner":"A"}')).toBe('tie');
    expect(parseCorrectnessLedger('{"a_correct":null,"b_correct":false,"winner":"A"}')).toBe('A');
    expect(parseCorrectnessLedger('{"a_correct":false,"b_correct":null,"winner":"B"}')).toBe('B');
    expect(parseCorrectnessLedger('{"a_correct":true,"winner":"A"}')).toBe('tie');
  });
});
