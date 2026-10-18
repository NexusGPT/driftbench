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

describe('near-JSON: the outcome written with capitals', () => {
  it('reads Pass, FAIL and Inconclusive as the verdict they spell, and marks the result repaired', () => {
    for (const [written, outcome] of [
      ['Pass', 'pass'],
      ['FAIL', 'fail'],
      [' Inconclusive ', 'inconclusive'],
    ] as const) {
      const result = parseAnswerText(`{"outcome":"${written}","reasoning":"r"}`);
      expect(result.answer.outcome).toBe(outcome);
      expect(result.unparsed).toBeUndefined();
      expect(result.repaired).toBe(true);
    }
  });

  it('leaves an exact outcome unmarked and an unknown word unparsed', () => {
    expect(parseAnswerText('{"outcome":"pass","reasoning":"r"}').repaired).toBeUndefined();
    const unknown = parseAnswerText('{"outcome":"Yes","reasoning":"r"}');
    expect(unknown.unparsed).toBe(true);
    expect(unknown.answer.outcome).toBe('inconclusive');
  });
});

describe('near-JSON: the score written as a number in quotes', () => {
  it('reads "0.28" as 0.28 and marks the result repaired', () => {
    const result = parseAnswerText('{"outcome":"fail","score":"0.28","reasoning":"r"}');
    expect(result.answer).toEqual({ outcome: 'fail', score: 0.28, reasoning: 'r' });
    expect(result.repaired).toBe(true);
  });

  it('leaves a word, an empty string and an out-of-range number unparsed', () => {
    for (const score of ['"high"', '""', '"7"', '" "']) {
      const result = parseAnswerText(`{"outcome":"pass","score":${score},"reasoning":"r"}`);
      expect(result.unparsed).toBe(true);
      expect(result.answer.outcome).toBe('inconclusive');
    }
  });
});

describe('near-JSON: an object written with single quotes', () => {
  it('reads it and marks the result repaired', () => {
    const result = parseAnswerText("{'outcome':'pass','score':0.88,'reasoning':'ok'}");
    expect(result.answer).toEqual({ outcome: 'pass', score: 0.88, reasoning: 'ok' });
    expect(result.repaired).toBe(true);
  });

  it('keeps a double quote and an escaped apostrophe inside a single-quoted string', () => {
    const result = parseAnswerText(String.raw`{'outcome':'fail','reasoning':'said \"no\" and it\'s final'}`);
    expect(result.answer.reasoning).toBe('said "no" and it\'s final');
    expect(result.repaired).toBe(true);
  });

  it('leaves a half-quoted object unparsed', () => {
    const result = parseAnswerText('{\'outcome\':\'pass","reasoning":"r"}');
    expect(result.unparsed).toBe(true);
  });
});

describe('near-JSON: a comma before a closing brace', () => {
  it('reads the object and marks the result repaired', () => {
    const result = parseAnswerText('{"outcome":"pass","score":0.73,"reasoning":"ok",}');
    expect(result.answer).toEqual({ outcome: 'pass', score: 0.73, reasoning: 'ok' });
    expect(result.repaired).toBe(true);
  });

  it('drops the comma outside strings only', () => {
    const result = parseAnswerText('{"outcome":"pass","reasoning":"a,} stays", }');
    expect(result.answer.reasoning).toBe('a,} stays');
    expect(result.repaired).toBe(true);
  });

  it('leaves two commas unparsed', () => {
    expect(parseAnswerText('{"outcome":"pass","reasoning":"r",,}').unparsed).toBe(true);
  });
});

describe('near-JSON: a line that is only a comment', () => {
  it('drops the // line, reads the object and marks the result repaired', () => {
    const result = parseAnswerText(
      '{\n  // the verdict follows\n  "outcome": "pass",\n  "reasoning": "ok"\n}',
    );
    expect(result.answer).toEqual({ outcome: 'pass', reasoning: 'ok' });
    expect(result.repaired).toBe(true);
  });

  it('keeps a // inside a string value', () => {
    const result = parseAnswerText(
      '{\n  "outcome": "pass",\n  "reasoning": "see http://a.b\\n// not a comment"\n}',
    );
    expect(result.answer.reasoning).toBe('see http://a.b\n// not a comment');
    expect(result.repaired).toBeUndefined();
  });

  it('leaves a comment after a value on the same line unparsed', () => {
    expect(parseAnswerText('{"outcome":"pass", // yes\n"reasoning":"r"}').unparsed).toBe(true);
  });
});

describe('near-JSON: typographic double quotes', () => {
  it('reads curly quotes around keys and strings and marks the result repaired', () => {
    const result = parseAnswerText('{“outcome”:“pass”,“score”:0.76,“reasoning”:“ok”}');
    expect(result.answer).toEqual({ outcome: 'pass', score: 0.76, reasoning: 'ok' });
    expect(result.repaired).toBe(true);
  });

  it('keeps a straight-quoted string with curly quotes inside it as it is', () => {
    const result = parseAnswerText('{"outcome":"pass","reasoning":"the reply said “yes”"}');
    expect(result.answer.reasoning).toBe('the reply said “yes”');
    expect(result.repaired).toBeUndefined();
  });

  it('escapes a straight quote inside a curly-quoted string', () => {
    const result = parseAnswerText('{“outcome”:“pass”,“reasoning”:“a "b" c”}');
    expect(result.answer.reasoning).toBe('a "b" c');
  });
});

describe('a probability outside 0 to 1', () => {
  it('is inconclusive, never a verdict', () => {
    for (const p of [1.01, 7, -0.01, -3, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(outcomeFromProbability(p)).toBe('inconclusive');
    }
  });

  it('still maps 0, 1 and the bounds', () => {
    expect(outcomeFromProbability(1)).toBe('pass');
    expect(outcomeFromProbability(0)).toBe('fail');
    expect(outcomeFromProbability(0.6)).toBe('pass');
    expect(outcomeFromProbability(0.4)).toBe('fail');
  });
});

describe('bounds that cross', () => {
  it('refuses a failAt that is not under passAt, whatever the probability', () => {
    expect(() => outcomeFromProbability(0.5, { passAt: 0.3, failAt: 0.7 })).toThrow(RangeError);
    expect(() => outcomeFromProbability(0.5, { passAt: 0.5, failAt: 0.5 })).toThrow(RangeError);
    expect(() => outcomeFromProbability(7, { passAt: 0.3, failAt: 0.7 })).toThrow(RangeError);
  });

  it('accepts one bound alone when it keeps failAt under passAt', () => {
    expect(outcomeFromProbability(0.5, { passAt: 0.45 })).toBe('pass');
    expect(() => outcomeFromProbability(0.5, { failAt: 0.7 })).toThrow(RangeError);
  });
});
