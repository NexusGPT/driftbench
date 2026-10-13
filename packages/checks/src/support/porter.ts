/**
 * The Porter stemming rules, as the rouge-style tokeniser applies them: a word is reduced to its stem in five
 * passes. Used only when a caller asks for stemmed overlap scores; the default overlap scores are unstemmed.
 */

const VOWELS = 'aeiou';

function isConsonant(word: string, i: number): boolean {
  const ch = word[i] ?? '';
  if (VOWELS.includes(ch)) return false;
  if (ch === 'y') return i === 0 ? true : !isConsonant(word, i - 1);
  return true;
}

/** m: the number of vowel-consonant sequences in the stem. */
function measure(stem: string): number {
  let m = 0;
  let i = 0;
  const n = stem.length;
  while (i < n && isConsonant(stem, i)) i += 1;
  while (i < n) {
    while (i < n && !isConsonant(stem, i)) i += 1;
    if (i >= n) break;
    m += 1;
    while (i < n && isConsonant(stem, i)) i += 1;
  }
  return m;
}

const hasVowel = (stem: string) => [...stem].some((_, i) => !isConsonant(stem, i));
const endsDoubleConsonant = (w: string) =>
  w.length >= 2 && w[w.length - 1] === w[w.length - 2] && isConsonant(w, w.length - 1);
const endsCvc = (w: string) => {
  const n = w.length;
  if (n < 3) return false;
  if (!isConsonant(w, n - 1) || isConsonant(w, n - 2) || !isConsonant(w, n - 3)) return false;
  return !'wxy'.includes(w[n - 1] ?? '');
};

function _replaceSuffix(
  word: string,
  suffix: string,
  replacement: string,
  minMeasure: number,
): string | undefined {
  if (!word.endsWith(suffix)) return undefined;
  const stem = word.slice(0, word.length - suffix.length);
  return measure(stem) > minMeasure - 1 ? stem + replacement : word;
}

function step1a(w: string): string {
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ies')) return w.slice(0, -2);
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function step1b(w: string): string {
  if (w.endsWith('eed')) {
    const stem = w.slice(0, -3);
    return measure(stem) > 0 ? `${stem}ee` : w;
  }
  let stem: string | undefined;
  if (w.endsWith('ed') && hasVowel(w.slice(0, -2))) stem = w.slice(0, -2);
  else if (w.endsWith('ing') && hasVowel(w.slice(0, -3))) stem = w.slice(0, -3);
  if (stem === undefined) return w;
  if (stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz')) return `${stem}e`;
  if (endsDoubleConsonant(stem) && !'lsz'.includes(stem[stem.length - 1] ?? '')) return stem.slice(0, -1);
  if (measure(stem) === 1 && endsCvc(stem)) return `${stem}e`;
  return stem;
}

function step1c(w: string): string {
  if (
    w.endsWith('y') &&
    w.length > 2 &&
    hasVowel(w.slice(0, -1)) &&
    !VOWELS.includes(w[w.length - 2] ?? '')
  ) {
    return `${w.slice(0, -1)}i`;
  }
  return w;
}

const STEP2: [string, string][] = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['bli', 'ble'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
  ['logi', 'log'],
  ['fulli', 'ful'],
];

const STEP3: [string, string][] = [
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
];

const STEP4 = [
  'al',
  'ance',
  'ence',
  'er',
  'ic',
  'able',
  'ible',
  'ant',
  'ement',
  'ment',
  'ent',
  'ion',
  'ou',
  'ism',
  'ate',
  'iti',
  'ous',
  'ive',
  'ize',
];

function applyTable(w: string, table: [string, string][]): string {
  for (const [suffix, replacement] of table) {
    if (w.endsWith(suffix)) {
      const stem = w.slice(0, w.length - suffix.length);
      if (measure(stem) > 0) return stem + replacement;
      return w;
    }
  }
  return w;
}

function step4(w: string): string {
  for (const suffix of STEP4) {
    if (w.endsWith(suffix)) {
      const stem = w.slice(0, w.length - suffix.length);
      if (suffix === 'ion') {
        if (measure(stem) > 1 && /[st]$/.test(stem)) return stem;
        return w;
      }
      if (measure(stem) > 1) return stem;
      return w;
    }
  }
  return w;
}

function step5(w: string): string {
  let out = w;
  if (out.endsWith('e')) {
    const stem = out.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) out = stem;
  }
  if (out.endsWith('ll') && measure(out.slice(0, -1)) > 1) out = out.slice(0, -1);
  return out;
}

/** The Porter stem of a lower-case word. Words of three letters or fewer are returned unchanged. */
export function porterStem(word: string): string {
  if (word.length <= 2) return word;
  let w = step1a(word);
  w = step1b(w);
  w = step1c(w);
  w = applyTable(w, STEP2);
  w = applyTable(w, STEP3);
  w = step4(w);
  w = step5(w);
  return w;
}
