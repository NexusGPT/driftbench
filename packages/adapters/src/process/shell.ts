/** Quotes one word for a POSIX shell. Plain words stay as they are, so a command line stays readable. */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Joins words into one shell command line. */
export function shellLine(words: readonly string[]): string {
  return words.map(shellQuote).join(' ');
}
