import { describe, expect, it } from 'vitest';
import { type JudgeRequest, parseJudgeText } from '../src/index';
import fixtures from './fixtures/mm-presentation-quotes.json';

describe('real MM winner quote presentation and overlapping continuation', () => {
  for (const fixture of fixtures) {
    const reject = fixture.itemId === '3929' || fixture.recordingHash === 'feea90bd2b6d7bbf9713';
    it(`${fixture.itemId} ${fixture.order} ${fixture.recordingHash} ${reject ? 'keeps paraphrase or ambiguity rejected' : 'preserves the raw winner'}`, () => {
      const result = parseJudgeText(fixture.rawText, fixture.request as JudgeRequest);
      expect(result.unparsed === true).toBe(reject);
      if (!reject) expect(result.winner).toBe(fixture.rawWinner);
    });
  }
  it('does not normalize semantic punctuation, paraphrases, wrong labels or malformed JSON', () => {
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [],
      assessment: { kind: 'pairwise' },
      candidates: { A: '8 - 2 = 6', B: '8 + 2 = 10' },
    };
    const answer = (winnerQuote: string) =>
      parseJudgeText(JSON.stringify({ winner: 'A', winnerQuote, reasoning: 'r' }), request);
    expect(answer('8 - 2 = 6').winner).toBe('A');
    expect(answer('8 + 2 = 6').unparsed).toBe(true);
    expect(answer('Reply B: 8 - 2 = 6').unparsed).toBe(true);
    expect(answer('eight minus two is six').unparsed).toBe(true);
    expect(
      parseJudgeText(JSON.stringify({ winner: 'A', winnerQuote: 'Line one\nValue 4', reasoning: 'r' }), {
        ...request,
        candidates: { A: '{"text":["Line one\\nValue 4",]}', B: 'Value 5' },
      }).unparsed,
    ).toBe(true);
  });
});
