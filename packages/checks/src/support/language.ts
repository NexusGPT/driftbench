import { createRequire } from 'node:module';

type Franc = typeof import('franc-min');

/**
 * franc-min builds its trigram tables of 82 languages when it loads, so it loads on the first detection, not
 * with the package: the lang check awaits loadDetector before it detects, and a direct call to detect loads it
 * synchronously (require of an ES module, Node 22.12 and later).
 */
let franc: Franc['francAll'] | undefined;

export async function loadDetector(): Promise<void> {
  franc ??= (await import('franc-min')).francAll;
}

export function detectorLoaded(): boolean {
  return franc !== undefined;
}

function francAll(text: string): ReturnType<Franc['francAll']> {
  franc ??= (createRequire(import.meta.url)('franc-min') as Franc).francAll;
  return franc(text);
}

/**
 * Language detection for the lang check, on franc-min (trigram profiles of 82 languages).
 *
 * Trigram detection is unreliable on short texts and is pulled off course by names: an English reply that
 * names a street and three plans can score French first. So a text is read twice, as written and without
 * its capitalised words (names, brands, the start of a sentence kept), after removing what carries no
 * language (links, email addresses, words with digits or slashes). A reading counts when it keeps at least
 * `minLetters` letters. A text is consistent with a language when either reading puts that language within
 * `margin` of its top score.
 */

export type DetectOptions = {
  /** The fewest letters a reading needs before it is judged. */
  minLetters: number;
  /** How far below the top score a language may sit and still count as the text's language. */
  margin: number;
};

export const DETECT_DEFAULTS: DetectOptions = { minLetters: 30, margin: 0.05 };

export type Reading = { letters: number; scores: Map<string, number>; top: string; lead: number };

export type Detection = {
  /** The readings long enough to judge: the one without names first, then the text as written. */
  readings: Reading[];
  /** The most letters of any reading, for the evidence of a text too short to judge. */
  letters: number;
};

/**
 * Detections already made, by text and letter floor: the detector is pure, and a run reads the same replies
 * again (every block of the keep mode looks back at the earlier ones; repeats and wordings say the same
 * thing). Bounded; the oldest entry goes first. A cached detection is shared, so callers only read it.
 */
const CACHE_LIMIT = 4096;
const cache = new Map<string, Detection>();

export function detect(text: string, options: DetectOptions = DETECT_DEFAULTS): Detection {
  const key = `${options.minLetters}\u0000${text}`;
  const held = cache.get(key);
  if (held !== undefined) return held;
  const detection = detectUncached(text, options);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, detection);
  return detection;
}

function detectUncached(text: string, options: DetectOptions): Detection {
  const plain = stripNoise(text);
  const readings: Reading[] = [];
  let letters = 0;
  for (const variant of [withoutNames(plain), plain]) {
    const count = countLetters(variant);
    letters = Math.max(letters, count);
    if (count < options.minLetters) continue;
    const tuples = francAll(variant);
    const [first, second] = tuples;
    if (!first || first[0] === 'und') continue;
    readings.push({
      letters: count,
      scores: new Map(tuples),
      top: first[0],
      lead: first[1] - (second?.[1] ?? 0),
    });
  }
  return { readings, letters };
}

/**
 * Function words of English. Franc-min misreads short English replies, because its trigram models were fitted on
 * longer text (a reply of a dozen words can score Hmong above English). A text whose words are at least a quarter
 * function words of the language, three or more of them, is consistent with that language: a count of its own
 * words, not an assumption. A French or Dutch reply holds none of these words, so it is still flagged.
 */
const FUNCTION_WORDS: Record<string, ReadonlySet<string>> = {
  eng: new Set([
    'i',
    'you',
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'to',
    'in',
    'on',
    'for',
    'with',
    'is',
    'are',
    'was',
    'be',
    'it',
    'that',
    'this',
    'not',
    'do',
    'did',
    'would',
    'could',
    'can',
    'your',
    'my',
    'we',
    'what',
    'which',
    'at',
    'from',
    'by',
    'if',
    'so',
    'there',
    'here',
    'me',
    'us',
    'them',
    'will',
    'have',
    'has',
  ]),
};

/** True when the text's words are function words of `code`: three or more, and a quarter of its words or more. */
export function functionWordVote(text: string, code: string): boolean {
  const words = countableWords(text);
  const list = FUNCTION_WORDS[code];
  if (list === undefined || words.length === 0) return false;
  const hits = words.filter((word) => list.has(word)).length;
  return hits >= 3 && hits / words.length >= 0.25;
}

function countableWords(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => word.length > 0);
}

/** True when a reading puts `code` within the margin of its top score. */
export function isConsistent(detection: Detection, code: string, options = DETECT_DEFAULTS): boolean {
  return detection.readings.some((reading) => (reading.scores.get(code) ?? 0) >= 1 - options.margin);
}

/** The best score any reading gives `code`, for evidence. */
export function bestScore(detection: Detection, code: string): number {
  return Math.max(0, ...detection.readings.map((reading) => reading.scores.get(code) ?? 0));
}

/** The language a text is in when a reading is sure of it: its top language leads by the margin. */
export function confidentLanguage(detection: Detection, options = DETECT_DEFAULTS): string | undefined {
  return detection.readings.find((reading) => reading.lead >= options.margin)?.top;
}

/** The top language of the first reading, for the evidence of a mismatch. */
export function topLanguage(detection: Detection): string | undefined {
  return detection.readings[0]?.top;
}

function stripNoise(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\S*[\d_/\\]\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops the capitalised words that do not start a sentence: names, brands, places. */
function withoutNames(text: string): string {
  let sentenceStart = true;
  const kept: string[] = [];
  for (const word of text.split(' ')) {
    if (word === '') continue;
    if (sentenceStart || !/^\P{L}*\p{Lu}/u.test(word)) kept.push(word);
    sentenceStart = /[.!?:;]\P{L}*$/u.test(word);
  }
  return kept.join(' ');
}

function countLetters(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0;
}

/**
 * Spec language codes (ISO 639-1 such as EN, FR, NL, or a tag such as fr-BE) to the ISO 639-3 codes
 * franc-min returns. Only languages franc-min has a model for are listed.
 */
const ISO_639_1: Record<string, string> = {
  am: 'amh',
  ar: 'arb',
  az: 'azj',
  be: 'bel',
  bg: 'bul',
  bn: 'ben',
  bs: 'bos',
  cs: 'ces',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fa: 'pes',
  ff: 'fuv',
  fr: 'fra',
  gu: 'guj',
  ha: 'hau',
  hi: 'hin',
  hr: 'hrv',
  hu: 'hun',
  id: 'ind',
  ig: 'ibo',
  it: 'ita',
  ja: 'jpn',
  jv: 'jav',
  kk: 'kaz',
  kn: 'kan',
  ko: 'kor',
  ln: 'lin',
  mg: 'plt',
  ml: 'mal',
  mr: 'mar',
  ms: 'zlm',
  my: 'mya',
  ne: 'npi',
  nl: 'nld',
  ny: 'nya',
  pa: 'pan',
  pl: 'pol',
  ps: 'pbu',
  pt: 'por',
  qu: 'qug',
  ro: 'ron',
  rn: 'run',
  ru: 'rus',
  rw: 'kin',
  si: 'sin',
  so: 'som',
  sr: 'srp',
  su: 'sun',
  sv: 'swe',
  sw: 'swh',
  ta: 'tam',
  te: 'tel',
  th: 'tha',
  tl: 'tgl',
  tr: 'tur',
  uk: 'ukr',
  ur: 'urd',
  uz: 'uzn',
  vi: 'vie',
  yo: 'yor',
  zh: 'cmn',
  zu: 'zul',
};

const KNOWN_639_3 = new Set([
  ...Object.values(ISO_639_1),
  'ceb',
  'ckb',
  'hms',
  'hnj',
  'ilo',
  'koi',
  'mad',
  'mag',
  'mai',
  'bho',
  'skr',
  'zyb',
]);

/** The franc-min code for a spec language code, or undefined when franc-min has no model for it. */
export function toDetectorCode(lang: string): string | undefined {
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (primary.length === 2) return ISO_639_1[primary];
  return KNOWN_639_3.has(primary) ? primary : undefined;
}
