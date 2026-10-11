import { describe, expect, it } from 'vitest';
import { outcomeFromProbability, parseAnswerText, parseAnswerValue } from '../src/index';

describe('the answer contract', () => {
  it('reads a bare JSON answer', () => {
    const result = parseAnswerText(
      '{"outcome":"fail","score":0.1,"reasoning":"two questions","evidence":"?"}',
    );
    expect(result.unparsed).toBeUndefined();
    expect(result.answer).toEqual({ outcome: 'fail', score: 0.1, reasoning: 'two questions', evidence: '?' });
  });

  it('reads an answer inside a fenced block or prose, braces inside strings included', () => {
    const fenced = 'Here it is:\n```json\n{"outcome":"pass","reasoning":"a {brace} \\" quote"}\n```\nDone.';
    expect(parseAnswerText(fenced).answer).toEqual({ outcome: 'pass', reasoning: 'a {brace} " quote' });
  });

  const broken: Array<[string, string]> = [
    ['no JSON', 'The reply passes.'],
    ['cut JSON', '{"outcome":"pass","reasoning":"cut'],
    ['an unknown outcome', '{"outcome":"yes","reasoning":"r"}'],
    ['an extra key', '{"outcome":"pass","reasoning":"r","confidence":1}'],
    ['no reasoning', '{"outcome":"pass"}'],
    ['a score above 1', '{"outcome":"pass","score":7,"reasoning":"r"}'],
    ['an empty text', ''],
  ];
  for (const [label, raw] of broken) {
    it(`turns ${label} into an unparsed inconclusive answer, never a pass`, () => {
      const result = parseAnswerText(raw);
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.unparsed).toBe(true);
      expect(result.raw).toBe(raw);
    });
  }

  it('validates an already decoded answer', () => {
    expect(parseAnswerValue({ outcome: 'pass', reasoning: 'ok' }).answer.outcome).toBe('pass');
    expect(parseAnswerValue({ outcome: 'pass' }).unparsed).toBe(true);
    expect(parseAnswerValue(null).answer.outcome).toBe('inconclusive');
  });

  it('maps a probability to an outcome with an inconclusive middle', () => {
    expect(outcomeFromProbability(0.95)).toBe('pass');
    expect(outcomeFromProbability(0.6)).toBe('pass');
    expect(outcomeFromProbability(0.5)).toBe('inconclusive');
    expect(outcomeFromProbability(0.4)).toBe('fail');
    expect(outcomeFromProbability(0.7, { passAt: 0.8 })).toBe('inconclusive');
  });
});

describe('the answer contract after prose with braces', () => {
  it('reads the first object that meets the contract, past brace pairs and an example object', () => {
    expect(
      parseAnswerText('Applying {rubric} to {data}: {"outcome":"fail","reasoning":"r"}').answer.outcome,
    ).toBe('fail');
    expect(
      parseAnswerText(
        'Format: {"outcome": "<pass or fail>", "reasoning": "<why>"}. Mine: {"outcome":"pass","reasoning":"ok"}',
      ).answer.outcome,
    ).toBe('pass');
    expect(parseAnswerText('{"answer":{"outcome":"pass","reasoning":"r"}}').unparsed).toBe(true);
  });
});
