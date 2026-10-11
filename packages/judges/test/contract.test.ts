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

describe('the outcome without case', () => {
  it('reads PASS and Fail as pass and fail, and still refuses an unknown word', () => {
    expect(parseAnswerText('{"outcome":"PASS","reasoning":"r"}').answer.outcome).toBe('pass');
    expect(parseAnswerText('{"outcome":" Fail ","reasoning":"r"}').answer.outcome).toBe('fail');
    expect(parseAnswerText('{"outcome":"YES","reasoning":"r"}').unparsed).toBe(true);
  });
});

describe('a score in quotes', () => {
  it('reads "0.92" as 0.92 and refuses a score that is not a number', () => {
    expect(parseAnswerText('{"outcome":"pass","score":"0.92","reasoning":"r"}').answer.score).toBe(0.92);
    expect(parseAnswerText('{"outcome":"pass","score":"high","reasoning":"r"}').unparsed).toBe(true);
  });
});

describe('single quotes', () => {
  it("reads {'outcome': 'fail', ...} and keeps a double-quoted answer as JSON", () => {
    expect(parseAnswerText("{'outcome': 'fail', 'reasoning': 'r'}").answer.outcome).toBe('fail');
    expect(parseAnswerText(`{"outcome":"pass","reasoning":"it's fine"}`).answer.reasoning).toBe("it's fine");
  });
});

describe('a trailing comma', () => {
  it('reads an answer with a comma before its closing brace', () => {
    expect(parseAnswerText('{"outcome":"pass","reasoning":"r",}').answer.outcome).toBe('pass');
    expect(parseAnswerText("{'outcome':'fail','reasoning':'r', }").answer.outcome).toBe('fail');
  });
});

describe('a comment line', () => {
  it('reads an answer with a // comment line and keeps // inside a string', () => {
    expect(
      parseAnswerText('{\n  // the verdict follows\n  "outcome": "fail",\n  "reasoning": "r"\n}').answer
        .outcome,
    ).toBe('fail');
    expect(parseAnswerText('{"outcome":"pass","reasoning":"see https://example.com"}').answer.reasoning).toBe(
      'see https://example.com',
    );
  });
});

describe('typographic quotes', () => {
  it('reads an answer written with curly quotes', () => {
    expect(parseAnswerText('{“outcome”: “pass”, “reasoning”: “r”}').answer.outcome).toBe('pass');
  });
});

describe('a score that contradicts the outcome', () => {
  it('refuses a pass scored 0.05 and a fail scored 0.97', () => {
    expect(parseAnswerText('{"outcome":"pass","score":0.05,"reasoning":"r"}').unparsed).toBe(true);
    expect(parseAnswerText('{"outcome":"fail","score":0.97,"reasoning":"r"}').unparsed).toBe(true);
    expect(parseAnswerText('{"outcome":"fail","score":0.5,"reasoning":"r"}').answer.outcome).toBe('fail');
  });
});
