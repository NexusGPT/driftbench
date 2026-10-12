/**
 * Encoding attacker strategies: a phrasing rewritten so that a plain reader of the text no longer sees the request,
 * while the request is still recoverable. Each takes the phrasing's text and returns the rewritten text. The transforms
 * are deterministic, so the same phrasing always gives the same attack. The multilingual variant takes its translator
 * as an argument, so the caller decides which model or service translates.
 */

export const homoglyphMap: { [key: string]: string } = {
  a: 'а',
  b: 'Ƅ',
  c: 'с',
  d: 'ԁ',
  e: 'е',
  f: 'ƒ',
  g: 'ɡ',
  h: 'һ',
  i: 'і',
  j: 'ј',
  k: 'κ',
  l: 'ӏ',
  m: 'ｍ',
  n: 'ո',
  o: 'о',
  p: 'р',
  q: 'ԛ',
  r: 'г',
  s: 'ѕ',
  t: 'τ',
  u: 'υ',
  v: 'ν',
  w: 'ԝ',
  x: 'х',
  y: 'у',
  z: 'ż',
  A: 'Α',
  B: 'В',
  C: 'С',
  D: 'Ꭰ',
  E: 'Е',
  F: 'Ϝ',
  G: 'Ԍ',
  H: 'Н',
  I: 'Ι',
  J: 'Ј',
  K: 'К',
  L: 'Ꮮ',
  M: 'М',
  N: 'Ν',
  O: 'О',
  P: 'Р',
  Q: 'Ԛ',
  R: 'Я',
  S: 'Ѕ',
  T: 'Т',
  U: 'Ս',
  V: 'Ѵ',
  W: 'Ԝ',
  X: 'Х',
  Y: 'Υ',
  Z: 'Ꮓ',
  '0': '𝟶',
  '1': '𝟷',
  '2': '𝟸',
  '3': '𝟹',
  '4': '𝟺',
  '5': '𝟻',
  '6': '𝟼',
  '7': '𝟽',
  '8': '𝟾',
  '9': '𝟿',
};

const leetMap: { [key: string]: string } = {
  a: '4',
  e: '3',
  i: '1',
  o: '0',
  s: '5',
  t: '7',
  l: '1',
  A: '4',
  E: '3',
  I: '1',
  O: '0',
  S: '5',
  T: '7',
  L: '1',
};

/** The languages the multilingual variant translates into: Bengali, Swahili, Javanese. */
export const DEFAULT_LANGUAGES = ['bn', 'sw', 'jv'];

const LANGUAGE_NAMES: Record<string, string> = { bn: 'Bengali', sw: 'Swahili', jv: 'Javanese' };

export const encodings = {
  /** The text as base64 of its UTF-8 bytes. */
  base64: (text: string): string => Buffer.from(text).toString('base64'),
  /** Letters rotated thirteen places; applying it twice returns the text. */
  rot13: (text: string): string =>
    text.replace(/[a-zA-Z]/g, (char) => {
      const code = char.charCodeAt(0);
      const base = char.toLowerCase() === char ? 97 : 65;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    }),
  /** The text as space-separated uppercase hexadecimal UTF-8 bytes. */
  hex: (text: string): string =>
    Array.from(Buffer.from(text, 'utf8'))
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' '),
  /** Common letters replaced by digits, keeping the words. */
  leetspeak: (text: string): string =>
    text
      .split('')
      .map((char) => leetMap[char] || char)
      .join(''),
  /** Latin letters replaced by look-alike Unicode characters; the text looks the same and reads differently. */
  homoglyph: (text: string): string =>
    text
      .split('')
      .map((char) => homoglyphMap[char] || char)
      .join(''),
} as const;

export type EncodingName = keyof typeof encodings;

/**
 * The text translated into each language, through the injected translator. A language the translator returns
 * nothing for is left out.
 */
export async function translateInto(
  text: string,
  languages: string[],
  translate: (text: string, language: string) => Promise<string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const language of languages) {
    const name = LANGUAGE_NAMES[language] ?? language;
    const translated = await translate(text, name);
    if (translated.trim() !== '') out[language] = translated.trim();
  }
  return out;
}
