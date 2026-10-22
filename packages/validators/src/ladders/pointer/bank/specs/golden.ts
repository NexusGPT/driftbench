import { GOLDEN_RULES, type GoldenRule } from '../../kit/golden-rules';
import { type FamilySpec, row, type Spec } from './types';

/**
 * The Golden Rules of the Pragmatic Segmenter (kit/golden-rules.ts, MIT; validators/pointer/THIRD-PARTY.md) as cut
 * items: one item per rule, its README input as a markdown paragraph, its README sentences as the units.
 *
 * Kept: the rules whose answer the design's cutter can give. It reads sentence breaks by shape only, with no word
 * list, and merges when unsure (docs/estate-pointer-reader.md, the sentence row of section 2). A paragraph holds the
 * input, so markdown reads it as a paragraph. Left out:
 * - Already items of the cutting family: EN 1-3 (sentences-split-terminators), EN 19 (sentences-decimal), EN 23
 *   (sentences-mask-url), EN 40 and 41 (sentences-hard-wrapped), EN 10 (sentences-short-title), JA 1
 *   (sentences-cjk-terminator), JA 5 (a hard wrap).
 * - Answers that need a word list: EN 9 against EN 7 (`Co. It` splits, `Co. at` does not, and `Co.` with a capital
 *   is the short-title shape the design merges), EN 14 and 15 against 16 (`U.S. How` against `U.S. Government`),
 *   EN 18 (`a.m. Mr.` against `P.M. Mr.`), EN 45 (`I. Did` against `I. Jones`), EN 51 (a unit that starts with
 *   `. . .`, a style choice), DE 2 to 4 (`12. Juni` stays one sentence, `Seite 12. Dort` splits).
 * - Inputs markdown reads otherwise: EN 31-39 (a line starting `1.`, `1)` or `a.` is a list item, one unit), EN 42
 *   (soft-wrapped lines are one paragraph).
 * - A comma or an ASCII colon as a sentence end: AR 1, 4 and 5; HY 1 and 3 (the README text uses U+003A).
 * - Answers the design contradicts: EN 44 (`Yahoo! in` stays one sentence, while docs/estate-pointer-reader.md,
 *   "A clear sentence boundary returned by the masked segmenter is not erased solely because the next sentence starts
 *   with a lowercase character", keeps the break).
 * EN 27 to 30, the four double-punctuation rules, are one item with one cause.
 */

const LANG: Record<string, string> = {
  en: 'EN',
  de: 'DE',
  ja: 'JA',
  ar: 'AR',
  it: 'IT',
  ru: 'RU',
  es: 'ES',
  el: 'EL',
  hi: 'HI',
  hy: 'HY',
  my: 'MY',
  am: 'AM',
  fa: 'FA',
  ur: 'UR',
  nl: 'NL',
};

/** The rules of each item: one rule, or the four double-punctuation rules together. */
export const GOLDEN_GROUPS: ReadonlyArray<{ key: string; rules: GoldenRule[] }> = (() => {
  const groups: Array<{ key: string; rules: GoldenRule[] }> = [];
  for (const rule of GOLDEN_RULES) {
    const merged = rule.lang === 'en' && rule.n >= 27 && rule.n <= 30;
    const key = merged ? 'gr-en-27-30' : `gr-${rule.lang}-${rule.n}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.rules.push(rule);
    else groups.push({ key, rules: [rule] });
  }
  return groups;
})();

const name = (rule: GoldenRule) => `${LANG[rule.lang] ?? rule.lang.toUpperCase()} ${rule.n}`;

function specOf(group: { key: string; rules: GoldenRule[] }): Spec {
  const [first] = group.rules as [GoldenRule];
  const names = group.rules.map(name).join(', ');
  const units = group.rules.map((rule) => rule.sentences.length).join(', ');
  const tier = first.lang === 'en' ? 2 : 3;
  return row(
    group.key,
    tier,
    `Pragmatic Segmenter Golden Rule ${names}: ${first.title}`,
    `The README input of ${names} as one markdown paragraph, and the same sentences after a seeded prose sentence.`,
    `Exact cut: the README's expected sentences as units, in order (${units} per input), plus the seeded sentence.`,
    `cutter:gr-${group.key.slice(3)}`,
  );
}

export const golden: FamilySpec = {
  id: 'golden',
  level: 'cut',
  component: 'cutter',
  needs: ['cut'],
  summary:
    'The sentence-boundary edge cases of the Pragmatic Segmenter Golden Rules that a shape-only cutter can answer, in 15 languages.',
  specs: GOLDEN_GROUPS.map(specOf),
};
