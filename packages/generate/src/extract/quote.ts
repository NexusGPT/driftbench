/**
 * Quotes are checked word for word against their source. Things a copy may change without changing the
 * words are folded first: runs of white space (a quote spans lines and indentation), typographic quote
 * marks, accents written composed or decomposed, characters that print nothing (zero-width spaces, soft
 * hyphens, direction marks) and the backslash that escapes a punctuation mark in markdown. Everything else, case and punctuation included, must match.
 */
export function foldQuote(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD\u202A-\u202E]/g, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Answers "is this quote in that source?" for many quotes, folding each source once. */
export class QuoteIndex {
  private readonly folded = new Map<string, string>();

  constructor(private readonly texts: ReadonlyMap<string, string>) {}

  has(source: string): boolean {
    return this.texts.has(source);
  }

  /** True when the source is known and holds the quote. A blank quote is never found. */
  contains(source: string, quote: string): boolean {
    const text = this.texts.get(source);
    if (text === undefined) return false;
    const needle = foldQuote(quote);
    if (needle === '') return false;
    let haystack = this.folded.get(source);
    if (haystack === undefined) {
      haystack = foldQuote(text);
      this.folded.set(source, haystack);
    }
    return haystack.includes(needle);
  }
}

/** One line for a report: the quote folded, cut at `width` characters. */
export function shortQuote(quote: string, width = 72): string {
  const folded = foldQuote(quote);
  return folded.length <= width ? folded : `${folded.slice(0, width - 3)}...`;
}
