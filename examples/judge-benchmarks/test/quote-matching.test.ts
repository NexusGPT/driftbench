import { describe, expect, it } from 'vitest';
import { candidateContainsQuote } from '../src/quote-matching';

describe('approved PR 115 quote matching', () => {
  it('matches Markdown, typography, case, and ordered omitted passages', () => {
    expect(
      candidateContainsQuote(
        '# Title\n- **Alpha** and _beta_.\nLast passage.',
        'title alpha ... last passage',
      ),
    ).toBe(true);
    expect(candidateContainsQuote('The “right” answer.', 'the "right" answer')).toBe(true);
    expect(candidateContainsQuote('First passage. Last passage.', 'last passage ... first passage')).toBe(
      false,
    );
  });
  it('matches rendered line separators in either source or quote', () => {
    expect(candidateContainsQuote('alpha⏎beta', 'alpha beta')).toBe(true);
    expect(candidateContainsQuote('alpha\nbeta', 'alpha⏎beta')).toBe(true);
  });
  it('decodes only strict JSON strings and text fields', () => {
    for (const source of [
      JSON.stringify('alpha\nbeta'),
      JSON.stringify({ text: 'alpha\nbeta' }),
      JSON.stringify({ text: ['alpha', 'beta'] }),
    ])
      expect(candidateContainsQuote(source, 'alpha beta')).toBe(true);
    expect(candidateContainsQuote('{"text":"alpha\\nbeta","text":"different"}', 'alpha beta')).toBe(false);
    expect(candidateContainsQuote('{"text":"alpha\\nbeta', 'alpha beta')).toBe(false);
  });
  it('requires real source text and keeps word boundaries and arithmetic', () => {
    for (const quote of ['', '...', '[assistant]', '***'])
      expect(candidateContainsQuote('[assistant] ... ***', quote)).toBe(false);
    expect(candidateContainsQuote('category', 'cat')).toBe(false);
    expect(candidateContainsQuote('user_name = 2 * 3', 'user name = 23')).toBe(false);
  });
});
