import type { RubricItem } from './assessment';

/**
 * Pair-ledger requirement rows for an open writing request, compiled from the request text alone.
 * Blind to both candidates. Hard rows come only from explicit request excerpts, quoted verbatim.
 */

// Python `re` word semantics: a word character is any letter, number or underscore in any script.
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const D = '\\p{Nd}';

const EXPLICIT: readonly (readonly [string, RegExp])[] = [
  [
    'length',
    new RegExp(
      `${B}${D}+\\s*(?:to\\s*${D}+\\s*)?(?:words?|characters?|lines?|paragraphs?)${B}|${D}+\\s*(?:字|行|段)`,
      'giu',
    ),
  ],
  [
    'language',
    new RegExp(
      `${B}(?:in|using|written in)\\s+(?:English|Chinese|Mandarin|French|Spanish)${B}|(?:用|使用)(?:中文|汉语|英文|英语)`,
      'giu',
    ),
  ],
  [
    'form',
    new RegExp(
      `${B}(?:write|create|compose|draft|produce)\\s+(?:(?:a|an|the|short|brief|long|concise)\\s+)*(?:poem|story|essay|speech|script|letter|memo|report|proposal|review|sonnet|haiku)${B}|(?:写|创作|撰写).{0,12}(?:小说|诗歌|散文|剧本|演讲|书信)`,
      'giu',
    ),
  ],
  [
    'named_element',
    new RegExp(
      `${B}(?:must include|must mention|must feature|required to include|include the (?:name|character|phrase|word)|mention the (?:name|character|phrase|word))${B}|(?:必须包含|必须包括|必须提及|务必包含)`,
      'giu',
    ),
  ],
];

/** The sentence or line around one match, as the recorded compiler cuts it. */
function excerpt(question: string, start: number, end: number): string {
  const from =
    Math.max(
      question.lastIndexOf('\n', start - 1),
      question.lastIndexOf('. ', start - 1),
      question.lastIndexOf('。', start - 1),
    ) + 1;
  const ends = ['\n', '. ', '。'].map((t) => question.indexOf(t, end)).filter((n) => n >= 0);
  return question.slice(from, ends.length ? Math.min(...ends) + 1 : question.length).trim();
}

const pyList = (values: readonly string[]) => `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;

export const BETTER_PIECE_V1 =
  'Holistically evaluate the complete piece for the actual writing request and intended reader: fulfillment, developed content, coherence, effective genre and style. This is the primary quality row. Length alone is neither a merit nor a defect. Respect requested repetition, invention and form; do not impose an unrelated writing style.';

/** Hard rows for explicit length, language, form and named-element excerpts of the request. */
export function explicitRequestRows(question: string): RubricItem[] {
  const rows: RubricItem[] = [];
  for (const [kind, pattern] of EXPLICIT) {
    const quotes: string[] = [];
    for (const match of question.matchAll(pattern)) {
      const quote = excerpt(question, match.index, match.index + match[0].length);
      if (quote && !quotes.includes(quote)) quotes.push(quote);
    }
    if (quotes.length)
      rows.push({
        name: kind,
        hard: true,
        rubric: `Follow only the explicit ${kind.replace('_', ' ')} constraint in these verbatim request excerpts. Do not invent a constraint: ${pyList(quotes)}`,
      });
  }
  return rows;
}

/** The rows of the recorded writing cell (research/ledger-wp 110c2fec), byte for byte. */
export function writingRequirementsV1(question: string): RubricItem[] {
  return [...explicitRequestRows(question), { name: 'better_piece', hard: false, rubric: BETTER_PIECE_V1 }];
}
