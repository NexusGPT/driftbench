/**
 * Encoding attacker strategies: a phrasing rewritten so that a plain reader of the text no longer sees the request,
 * while the request is still recoverable. Each takes the phrasing's text and returns the rewritten text. They are
 * deterministic, so the same phrasing always gives the same attack.
 */

const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  i: 'і',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
};

const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };

function rot13Letter(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + 13) % 26) + 65);
  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + 13) % 26) + 97);
  return ch;
}

export const encodings = {
  /** The text as base64 of its UTF-8 bytes. */
  base64: (text: string): string => Buffer.from(text, 'utf8').toString('base64'),
  /** Letters rotated thirteen places; applying it twice returns the text. */
  rot13: (text: string): string => [...text].map(rot13Letter).join(''),
  /** The text as hexadecimal UTF-8 bytes. */
  hex: (text: string): string => Buffer.from(text, 'utf8').toString('hex'),
  /** Common letters replaced by digits (a 4, e 3, i 1, o 0, s 5, t 7), keeping the words. */
  leetspeak: (text: string): string => [...text].map((ch) => LEET[ch.toLowerCase()] ?? ch).join(''),
  /** Latin letters replaced by Cyrillic look-alikes (a, c, e, i, o, p, x, y); the text looks the same and reads differently. */
  homoglyph: (text: string): string => [...text].map((ch) => LATIN_TO_CYRILLIC[ch] ?? ch).join(''),
} as const;

export type EncodingName = keyof typeof encodings;
