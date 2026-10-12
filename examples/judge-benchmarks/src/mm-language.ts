import { francAll } from 'franc-all';

// The language universe comes from MM-Eval's published scope, not an item's language or preference label.
const LANGUAGES = [
  'arb',
  'ben',
  'cat',
  'deu',
  'eng',
  'spa',
  'eus',
  'fra',
  'glg',
  'ita',
  'jpn',
  'kor',
  'rus',
  'swh',
  'tel',
  'tha',
  'vie',
  'cmn',
];
const SCRIPTS = [
  'Latin',
  'Arabic',
  'Bengali',
  'Cyrillic',
  'Hangul',
  'Han',
  'Hiragana',
  'Katakana',
  'Telugu',
  'Thai',
  'Devanagari',
];
const patterns = SCRIPTS.map((name) => [name, new RegExp(`\\p{Script=${name}}`, 'gu')] as const);
// Small function-word vocabularies. Shared words retain all possible languages; names are advisory.
const FUNCTION_WORDS: Record<string, string[]> = {
  eng: [
    'the',
    'and',
    'with',
    'from',
    'your',
    'their',
    'this',
    'that',
    'were',
    'have',
    'will',
    'should',
    'because',
    'which',
    'while',
    'between',
    'through',
    'however',
  ],
  spa: ['el', 'los', 'las', 'del', 'una', 'para', 'pero', 'cuando', 'donde', 'porque', 'aunque'],
  fra: ['les', 'des', 'une', 'pour', 'avec', 'mais', 'dans', 'leurs', 'ainsi', 'lorsque'],
  deu: ['der', 'die', 'das', 'ein', 'eine', 'und', 'mit', 'für', 'aber', 'weil', 'werden', 'auch'],
  ita: ['gli', 'della', 'sono', 'nella', 'degli', 'questo', 'perché', 'anche'],
  por: ['uma', 'não', 'seus', 'suas', 'com', 'pelo', 'pela', 'também', 'porque', 'para'],
};

function foreignWords(tokens: string[], expected: string | undefined, requestTokens: Set<string>) {
  const byWord = new Map<string, { token: string; count: number; possibleLanguages: string[] }>();
  if (!expected) return { count: 0, tokens: [] };
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (requestTokens.has(key)) continue;
    const possibleLanguages = Object.entries(FUNCTION_WORDS)
      .filter(([, list]) => list.includes(key))
      .map(([code]) => code);
    if (!possibleLanguages.length || possibleLanguages.includes(expected)) continue;
    const held = byWord.get(key) ?? { token, count: 0, possibleLanguages };
    held.count += 1;
    byWord.set(key, held);
  }
  return {
    count: [...byWord.values()].reduce((sum, x) => sum + x.count, 0),
    tokens: [...byWord.values()].slice(0, 20),
  };
}

function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
}
function words(text: string): string[] {
  return prose(text).match(/[\p{L}\p{M}]+/gu) ?? [];
}
function languages(text: string) {
  const clean = prose(text);
  const letters = clean.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 30) return { status: 'too short to identify reliably', letters, ranked: [] };
  return {
    letters,
    ranked: francAll(clean, { only: LANGUAGES, minLength: 30 })
      .slice(0, 3)
      .map(([language, score]) => ({ language, relativeTrigramScore: Number(score.toFixed(3)) })),
  };
}
function scripts(text: string) {
  const clean = prose(text);
  return Object.fromEntries(
    patterns
      .map(([name, pattern]) => [name, clean.match(pattern)?.length ?? 0])
      .filter(([, count]) => Number(count) > 0),
  );
}
function difference(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const word of b) counts.set(word, (counts.get(word) ?? 0) + 1);
  return a.filter((word) => {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      counts.set(word, count - 1);
      return false;
    }
    return true;
  });
}

/** Pure diagnostics on request and replies only. A model checks intent and legitimate foreign-language uses. */
export function languageEvidence(question: string, a: string, b: string) {
  const requestDetection = languages(question);
  const inferredRequestLanguage = requestDetection.ranked[0]?.language;
  const requestTokens = new Set(words(question).map((word) => word.toLowerCase()));
  const requestScripts = scripts(question);
  const wa = words(a),
    wb = words(b),
    onlyA = difference(wa, wb),
    onlyB = difference(wb, wa);
  const inspect = (text: string, unique: string[]) => {
    const wholeText = languages(text);
    return {
      wholeText,
      matchesInferredRequestLanguage:
        inferredRequestLanguage && wholeText.ranked[0]?.language
          ? inferredRequestLanguage === wholeText.ranked[0].language
          : null,
      scriptLetterCounts: scripts(text),
      scriptLetterCountsNotUsedByRequest: Object.fromEntries(
        Object.entries(scripts(text)).filter(([script]) => !requestScripts[script]),
      ),
      potentialForeignFunctionTokens: foreignWords(words(text), inferredRequestLanguage, requestTokens),
      distinctWords: unique.slice(0, 40),
      distinctWordLanguages: languages(unique.join(' ')),
      segmentLanguageChanges: prose(text)
        .split(/\n+|(?<=[.!?。！？])\s+/u)
        .map((part, index) => ({ index, detection: languages(part) }))
        .filter(
          (x) => x.detection.ranked[0] && x.detection.ranked[0]?.language !== wholeText.ranked[0]?.language,
        )
        .slice(0, 8),
    };
  };
  return {
    tool: 'franc-all 7.2.0 plus Unicode script counts; scores are relative trigram similarity, not probability',
    caution:
      'Short strings, names, quotations, code, loanwords and explicit translation instructions can invalidate an apparent mismatch. These are observations, not automatic penalties.',
    request: { detection: requestDetection, scriptLetterCounts: requestScripts },
    reply_A: inspect(a, onlyA),
    reply_B: inspect(b, onlyB),
    sharedWordFraction: Number(
      (1 - (onlyA.length + onlyB.length) / Math.max(1, wa.length + wb.length)).toFixed(3),
    ),
  };
}
