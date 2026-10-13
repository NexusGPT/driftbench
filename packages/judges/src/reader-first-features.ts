/** Deterministic observations, not semantic proof of a reader-facing defect. */
export type ReaderFeatures = {
  readonly language: 'en' | 'zh';
  readonly length: number;
  readonly words: number;
  readonly hanCharacters: number;
  readonly headings: number;
  readonly listItems: number;
  readonly paragraphs: number;
  readonly meanParagraphLength: number;
  readonly sentences: number;
  readonly meanSentenceLength: number;
  readonly readabilityGrade: number | null;
  readonly fillerDensity: number;
  readonly hedgeDensity: number;
  readonly repeatedSentenceRatio: number;
  readonly ngramRedundancy: number;
  readonly litotesDensity: number;
  readonly undefinedAcronymDensity: number;
  readonly jargonDensity: number;
  readonly contextReferenceDensity: number;
};

// Fixed dictionaries are intentionally small. A match can be appropriate in its
// genre: these counts cannot establish padding, harmful uncertainty or jargon.
const FILLER_EN = [
  'it is important to note that',
  'it is worth noting that',
  'needless to say',
  'at the end of the day',
  'as a matter of fact',
  'for all intents and purposes',
  "in today's world",
  'when it comes to',
  'in order to',
];
const FILLER_ZH = ['值得注意的是', '需要指出的是', '毋庸置疑', '众所周知', '总的来说', '在某种意义上'];
const HEDGE_EN = [
  'perhaps',
  'possibly',
  'arguably',
  'somewhat',
  'might',
  'may',
  'seems',
  'appears',
  'to some extent',
  'generally speaking',
];
const HEDGE_ZH = ['可能', '也许', '或许', '似乎', '大概', '某种程度上', '一般来说'];
const LITOTES_EN = [
  'not bad',
  'not unimportant',
  'no small',
  'not without',
  'not uncommon',
  'not insignificant',
  'not impossible',
  'not unreasonable',
];
const LITOTES_ZH = [
  '并非没有',
  '并不是没有',
  '不是没有',
  '不可谓不',
  '未尝不',
  '不无',
  '不算差',
  '不坏',
  '并非不重要',
  '不是不重要',
  '不可小觑',
];
const JARGON_EN = [
  'synergy',
  'paradigm',
  'operationalize',
  'ontology',
  'epistemic',
  'heteroskedasticity',
  'stochastic',
  'latent space',
  'vector embedding',
  'gradient descent',
  'idempotent',
  'orthogonal',
];
const JARGON_ZH = [
  '赋能',
  '抓手',
  '闭环',
  '底层逻辑',
  '范式',
  '正交',
  '幂等',
  '向量嵌入',
  '梯度下降',
  '异方差',
];
const EXTERNAL_CONTEXT_EN = [
  'as you know',
  'as we discussed',
  'as previously discussed',
  'same as before',
  'you already know',
];
const EXTERNAL_CONTEXT_ZH = ['你已经知道', '你也知道', '正如我们之前讨论的', '和之前一样'];
const ABOVE_CONTEXT_EN = [
  'as mentioned above',
  'as noted above',
  'as explained above',
  'see above',
  'the aforementioned',
];
const ABOVE_CONTEXT_ZH = ['如上所述', '上文提到', '正如前文所述', '见上文'];

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsIn = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/u).length);
const hanIn = (text: string): number => (text.match(/\p{Script=Han}/gu) ?? []).length;
const lexicalWords = (text: string): string[] => text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];

function phrasePattern(phrases: readonly string[], boundaries: boolean): RegExp {
  const body = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => escapePattern(phrase).replace(/ /g, '\\s+'))
    .join('|');
  return new RegExp(boundaries ? `(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])` : `(?:${body})`, 'giu');
}

function phraseCount(text: string, en: readonly string[], zh: readonly string[]): number {
  return (
    [...text.matchAll(phrasePattern(en, true))].length + [...text.matchAll(phrasePattern(zh, false))].length
  );
}

/** Sentence segmentation retains punctuation and does not flatten paragraphs. */
function sentenceParts(text: string, language: 'en' | 'zh'): string[] {
  return [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)]
    .map((part) => part.segment.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

function repeatRatio(parts: readonly string[]): number {
  if (parts.length === 0) return 0;
  return (parts.length - new Set(parts).size) / parts.length;
}

function ngramRedundancy(text: string, language: 'en' | 'zh'): number {
  const tokens =
    language === 'zh' ? (text.match(/\p{Script=Han}/gu) ?? []) : lexicalWords(text.toLowerCase());
  const grams: string[] = [];
  for (let i = 0; i + 4 <= tokens.length; i++) grams.push(tokens.slice(i, i + 4).join(' '));
  return repeatRatio(grams);
}

// A rough English syllable count for the Flesch-Kincaid formula. Proper names,
// loanwords, abbreviations and technical terms can produce inaccurate grades.
function syllables(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (lower.length <= 3) return 1;
  const stem = lower.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (stem.match(/[aeiouy]+/g) ?? []).length);
}

function isExpansion(expansion: string, acronym: string, preceding: boolean): boolean {
  if (hanIn(expansion) >= 2) return true;
  const terms = lexicalWords(expansion).map((word) => word.toLowerCase());
  const candidates = [
    terms,
    terms.filter((word) => !['a', 'an', 'and', 'of', 'the', 'for', 'to', 'in'].includes(word)),
  ];
  return candidates.some((candidate) => {
    const picked = preceding ? candidate.slice(-acronym.length) : candidate;
    return (
      picked.length >= 2 &&
      picked
        .map((word) => word[0])
        .join('')
        .toUpperCase() === acronym
    );
  });
}

/** All occurrences of a token count unless its first use contains an expansion. */
function undefinedAcronyms(text: string): number {
  const firstDefined = new Map<string, boolean>();
  let count = 0;
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}\b/g)) {
    const acronym = match[0];
    if (!firstDefined.has(acronym)) {
      const before = text.slice(Math.max(0, match.index - 180), match.index);
      const after = text.slice(match.index + acronym.length, match.index + acronym.length + 180);
      const afterLongForm = after.match(/^\s*[（(]([^()（）\n.!?。！？]+)[)）]/u);
      const beforeLongForm = before.match(/([^()（）\n.!?。！？]+)\s*[（(]\s*$/u);
      firstDefined.set(
        acronym,
        (afterLongForm !== null && isExpansion(afterLongForm[1] ?? '', acronym, false)) ||
          (/^\s*[)）]/u.test(after) &&
            beforeLongForm !== null &&
            isExpansion(beforeLongForm[1] ?? '', acronym, true)),
      );
    }
    if (!firstDefined.get(acronym)) count++;
  }
  return count;
}

function unexplainedJargon(text: string): number {
  let count = 0;
  for (const pattern of [phrasePattern(JARGON_EN, true), phrasePattern(JARGON_ZH, false)]) {
    for (const match of text.matchAll(pattern)) {
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 160);
      const parenthesis = after.match(/^\s*[(（]([^()（）.!?。！？]+)[)）]/u)?.[1];
      const definition = after.match(
        /^\s*[,，:]?\s*(?:means|meaning|that is|which means|refers to|is defined as|指的是|是指|意为|即)\s*[,，:]?\s*([^.!?。！？\n]+)/iu,
      )?.[1];
      const explained = [parenthesis, definition].some(
        (value) => value !== undefined && (lexicalWords(value).length >= 2 || hanIn(value) >= 2),
      );
      if (!explained) count++;
    }
  }
  return count;
}

function contextReferences(text: string, parts: readonly string[]): number {
  // External shared-history phrases always count. Internal "above" phrases
  // count only in the first sentence; later references may have an antecedent.
  // This conservative proxy cannot determine whether any antecedent is relevant.
  return (
    phraseCount(text, EXTERNAL_CONTEXT_EN, EXTERNAL_CONTEXT_ZH) +
    phraseCount(parts[0] ?? text, ABOVE_CONTEXT_EN, ABOVE_CONTEXT_ZH)
  );
}

/**
 * Length and paragraph means use whitespace units in English and Han characters
 * in Chinese. The words field always counts raw whitespace-delimited units.
 * Markdown markers therefore remain length units. Language detection compares
 * Han characters with Latin words and defaults to English on a tie.
 *
 * Densities count occurrences per 1,000 length units, not matched word coverage.
 * Repetition ratios count duplicate normalized sentences or 4-grams beyond the
 * first occurrence. Empty input has zero numeric features and a null grade.
 * Paragraphs are nonempty blank-line-separated blocks; a contiguous list is one
 * block. Headings include ATX and Setext syntax. Readability is an English-only
 * heuristic, never a calibrated measure of comprehension or writing quality.
 */
export function readerFeatures(text: string, language?: 'en' | 'zh'): ReaderFeatures {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const words = wordsIn(normalized);
  const hanCharacters = hanIn(normalized);
  const lang = language ?? (hanCharacters > lexicalWords(normalized).length ? 'zh' : 'en');
  const length = lang === 'zh' ? hanCharacters : words;
  const paragraphs =
    normalized === '' ? [] : normalized.split(/\n\s*\n/u).filter((part) => part.trim() !== '');
  const parts = sentenceParts(normalized, lang);
  const sentenceKeys = parts.map((part) =>
    part
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim(),
  );
  const lexical = lexicalWords(normalized);
  const grade =
    lang === 'en' && lexical.length > 0 && parts.length > 0
      ? 0.39 * (lexical.length / parts.length) +
        11.8 * (lexical.reduce((sum, word) => sum + syllables(word), 0) / lexical.length) -
        15.59
      : null;
  const density = (count: number): number => (length === 0 ? 0 : (count * 1000) / length);
  return {
    language: lang,
    length,
    words,
    hanCharacters,
    headings:
      (normalized.match(/^ {0,3}#{1,6}\s+\S.*$/gm) ?? []).length +
      (normalized.match(/^\S[^\n]*\n {0,3}(?:={3,}|-{3,})\s*$/gm) ?? []).length,
    listItems: (
      normalized.match(/^\s*(?:[-+*•]\s+|\d+[.)、]\s*|[一二三四五六七八九十]+[、.)]\s*)\S.*$/gm) ?? []
    ).length,
    paragraphs: paragraphs.length,
    meanParagraphLength: paragraphs.length === 0 ? 0 : length / paragraphs.length,
    sentences: parts.length,
    meanSentenceLength: parts.length === 0 ? 0 : length / parts.length,
    readabilityGrade: grade,
    fillerDensity: density(phraseCount(normalized, FILLER_EN, FILLER_ZH)),
    hedgeDensity: density(phraseCount(normalized, HEDGE_EN, HEDGE_ZH)),
    repeatedSentenceRatio: repeatRatio(sentenceKeys),
    ngramRedundancy: ngramRedundancy(normalized, lang),
    litotesDensity: density(phraseCount(normalized, LITOTES_EN, LITOTES_ZH)),
    undefinedAcronymDensity: density(undefinedAcronyms(normalized)),
    jargonDensity: density(unexplainedJargon(normalized)),
    contextReferenceDensity: density(contextReferences(normalized, parts)),
  };
}
