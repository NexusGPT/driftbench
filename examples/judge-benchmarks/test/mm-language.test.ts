import { describe, expect, it } from 'vitest';
import { languageEvidence } from '../src/mm-language';
import { parseMmVerdict } from '../src/mm';

describe('code language observations', () => {
  it('detects a language mismatch and exposes foreign scripts in prose', () => {
    const q =
      'Peux-tu expliquer simplement comment préparer un bon repas avec des légumes frais et des ingrédients de saison pour toute la famille ?';
    const a =
      'Pour préparer un bon repas, choisissez des légumes frais de saison et faites les cuire doucement avec un peu de beurre et de sel.';
    const b =
      'To prepare a healthy meal for the whole family, choose fresh seasonal vegetables and cook them gently with a little butter and salt.';
    const result = languageEvidence(q, a, b);
    expect(result.request.detection.ranked[0]?.language).toBe('fra');
    expect(result.reply_A.wholeText.ranked[0]?.language).toBe('fra');
    expect(result.reply_B.wholeText.ranked[0]?.language).toBe('eng');
    expect(result.reply_A.matchesInferredRequestLanguage).toBe(true);
    expect(result.reply_B.matchesInferredRequestLanguage).toBe(false);
    const mixed = languageEvidence(q, a, `${a} Это русский текст.`);
    expect(mixed.reply_B.scriptLetterCounts.Cyrillic).toBeGreaterThan(0);
    expect(mixed.reply_A.scriptLetterCounts.Cyrillic).toBeUndefined();
  });
  it('keeps observations symmetric under reply swaps', () => {
    const q = 'Describe a healthy recipe in English.';
    const a = 'Use fresh vegetables with a small amount of salt and cook gently.';
    const b = 'Use fresh vegetables with a small amount of sal and cook gently.';
    const ab = languageEvidence(q, a, b),
      ba = languageEvidence(q, b, a);
    expect(ab.reply_A).toEqual(ba.reply_B);
    expect(ab.reply_B).toEqual(ba.reply_A);
    expect(ab.sharedWordFraction).toBe(ba.sharedWordFraction);
    expect(ab.reply_A.distinctWords).toEqual(['salt']);
    expect(ab.reply_B.distinctWords).toEqual(['sal']);
  });
  it('does not label short texts or fenced code as foreign prose', () => {
    const x = languageEvidence('Hi', 'Hello', 'Hello\n```python\nпример = "外国文字"\n```');
    expect(x.reply_A.wholeText.ranked).toEqual([]);
    expect(x.reply_B.scriptLetterCounts.Cyrillic).toBeUndefined();
    expect(x.reply_B.scriptLetterCounts.Han).toBeUndefined();
  });
});
describe('winner to outcome mapping', () => {
  it('computes the outcome from the named winner, never from prose', () => {
    expect(parseMmVerdict('{"reasoning":"B refuses correctly", "winner":"B"}')).toEqual({
      winner: 'B',
      outcome: 'fail',
    });
    expect(parseMmVerdict('{"reasoning":"A refuses correctly", "winner":"A"}')).toEqual({
      winner: 'A',
      outcome: 'pass',
    });
    expect(parseMmVerdict('{"winner":"tie"}')).toEqual({ winner: 'tie', outcome: 'inconclusive' });
  });
});
