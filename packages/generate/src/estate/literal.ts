/** A word as a pattern that matches it literally. */
export function literal(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
