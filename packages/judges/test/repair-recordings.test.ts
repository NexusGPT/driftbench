import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { parseAnswerText, repairAnswerText } from '../src/contract';
import fixtures from './fixtures/mm-near-json.json';

describe('MM-Eval near-JSON recordings', () => {
  it('preserves valid JSON escapes and repairs only literal invalid escapes inside strings', () => {
    const strict = JSON.stringify({ outcome: 'pass', reasoning: 'quote " slash \\ newline\n' });
    expect(repairAnswerText(strict)).toBe(strict);
    const raw = String.raw`{"outcome":"pass","reasoning":"LaTeX \(x\), literal \q and invalid unicode \uXYZ1"}`;
    expect(parseAnswerText(raw).answer.reasoning).toBe(
      String.raw`LaTeX \(x\), literal \q and invalid unicode \uXYZ1`,
    );
    expect(parseAnswerText(String.raw`{"outcome":\pass,"reasoning":"bad"}`).unparsed).toBe(true);
  });
  it('uses the shared quote repair for the explicit-winner contract', () => {
    const result = parseJudgeText(
      '{"reasoning":"The facts include "four", "three".","winnerQuote":"4","winner":"B"}',
      {
        criterion: { name: 'c', rubric: 'Correct.' },
        transcript: [],
        assessment: { kind: 'pairwise' },
        candidates: { A: '3', B: '4' },
      },
    );
    expect(result.unparsed).toBeUndefined();
    expect(result.repaired).toBe(true);
    expect(result.winner).toBe('B');
  });
  for (const row of fixtures) {
    it(`recovers ${row.id} ${row.order} without changing its explicit verdict`, () => {
      const result = parseAnswerText(row.original);
      expect(result.unparsed).toBeUndefined();
      expect(result.repaired).toBe(true);
      const expected = row.id === '761' ? 'pass' : 'fail';
      expect(result.answer.outcome).toBe(expected);
      const value = JSON.parse(repairAnswerText(row.original));
      expect(value.outcome).toBe(expected);
      if (row.id === '2017') expect(value.reasoning).toContain('("ответ", "نہیں", "المالية الصحة", "组合")');
      else expect(value.evidence).toContain(String.raw`\(`);
    });
  }
  it('never repairs absent or conflicting verdict fields into a verdict', () => {
    for (const raw of [
      '{"reasoning":"passes"}',
      '{"outcome":"perhaps","reasoning":"passes"}',
      '{"outcome":"pass","reasoning":"ok", verdict: fail}',
      '{"outcome":"pass","reasoning":"cut',
    ])
      expect(parseAnswerText(raw).unparsed).toBe(true);
  });
});

it('legacy replay retains a historical unparsed answer even when the shared repair now recovers it', () => {
  const raw = fixtures[0]?.original as string;
  expect(parseAnswerText(raw).answer.outcome).toBe('fail');
  expect(
    parseJudgeText(raw, { criterion: { name: 'c', rubric: 'r' }, transcript: [], answerContract: 'legacy' })
      .unparsed,
  ).toBe(true);
});
