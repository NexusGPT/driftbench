import { describe, expect, it } from 'vitest';
import { foldQuote, QuoteIndex } from '../../src/extract';

const find = (source: string, quote: string) =>
  new QuoteIndex(new Map([['p.md', source]])).contains('p.md', quote);

describe('quotes survive what a model changes without changing the words', () => {
  it('finds a composed quote of decomposed accents', () => {
    expect(find('Réponds en français.'.normalize('NFD'), 'Réponds en français.'.normalize('NFC'))).toBe(true);
  });
  it('finds a quote written without zero-width spaces, soft hyphens and direction marks', () => {
    expect(find('Never pro\u200Bmise a date', 'Never promise a date')).toBe(true);
    expect(find('Keep it con\u00ADcise today', 'Keep it concise today')).toBe(true);
    expect(find('Never say\u200F refund early', 'Never say refund early')).toBe(true);
  });
  it('finds a quote written without markdown backslash escapes', () => {
    expect(find('Never use a \\* in a reply', 'Never use a * in a reply')).toBe(true);
    expect(find('Use snake\\_case names', 'Use snake_case names')).toBe(true);
  });
  it('still refuses other text, and keeps a backslash before a letter', () => {
    expect(find('Never promise a date', 'Always promise a date')).toBe(false);
    expect(foldQuote('C:\\users')).toBe('C:\\users');
  });
});
