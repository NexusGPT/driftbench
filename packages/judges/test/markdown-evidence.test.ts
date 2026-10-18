// biome-ignore-all lint/style/noNonNullAssertion: every asserted value is set a few lines above its use.
import { describe, expect, it } from 'vitest';
import { textContainsQuote } from '../src/evidence';
import { groundEvidence, type JudgeRequest, parseJudgeText } from '../src/index';
import { judgePairwise } from '../src/pairwise';
import fixture from './fixtures/markdown-winner-recording.json';

describe('Markdown quote identity', () => {
  for (const [text, quote] of [
    ['## Best answer\nThe result is **42**.', 'Best answer The result is 42.'],
    ['- Use `safe_mode` and _wait_.', 'Use safe_mode and wait.'],
    ['1. **First** step\n2. Second step', 'First step Second step'],
    ['plain result 42', '**plain** result `42`'],
  ]) {
    it(`matches substantive text across markup in ${JSON.stringify(text)}`, () => {
      expect(textContainsQuote(text!, quote!)).toBe(true);
      const request: JudgeRequest = {
        criterion: { name: 'c', rubric: 'r' },
        transcript: [{ role: 'agent', text: text! }],
      };
      expect(groundEvidence(request, { outcome: 'pass', reasoning: '', evidence: quote }).grounded).toBe(
        true,
      );
    });
  }
  it('preserves semantic underscores, word boundaries, order and unique identity', () => {
    expect(textContainsQuote('safe_mode', 'safemode')).toBe(false);
    expect(textContainsQuote('Actual answer', '**Actual ans**')).toBe(false);
    expect(textContainsQuote('One then two', 'two ... one')).toBe(false);
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [],
      assessment: { kind: 'pairwise' },
      candidates: { A: '**Shared** result', B: 'Shared result' },
    };
    expect(
      parseJudgeText('{"winner":"A","winnerQuote":"Shared result","reasoning":"same"}', request).unparsed,
    ).toBe(true);
    for (const quote of ['**', '__', '`', '## ', '...', '"', "'"]) {
      expect(textContainsQuote(quote, quote)).toBe(false);
    }
  });
  it('keeps the real initial MM winner A without re-asking in that order', async () => {
    const request = fixture.request as JudgeRequest;
    const result = parseJudgeText(fixture.attempts[0]!.text, request);
    expect(result.unparsed).toBeUndefined();
    expect(result.winner).toBe('A');
    const seen: JudgeRequest[] = [];
    const judge = {
      id: 'mm-recording',
      family: 'recorded',
      cls: 'system2' as const,
      cost: 1,
      async judge(r: JudgeRequest) {
        seen.push(r);
        return parseJudgeText(
          seen.length === 1
            ? fixture.attempts[0]!.text
            : JSON.stringify({
                winner: 'B',
                winnerQuote: fixture.attempts[0]!.rawQuote,
                reasoning: 'same candidate after swap',
              }),
          r,
        );
      },
    };
    const verdict = await judgePairwise(
      judge,
      request.criterion,
      [],
      request.candidates!.A,
      request.candidates!.B,
    );
    expect(seen).toHaveLength(2);
    expect(verdict.choice).toBe('first');
  });
});
