import type { JudgeRequest } from './contract';

/**
 * The data screen: a sentence in the observed data that speaks to the judge (a judge word and a verdict word
 * in one sentence) is flagged at the place it sits. A judge reads the data as data; the screen tells the caller
 * where a planted instruction may be, before a judge is asked.
 */

const JUDGE_WORDS = [
  'rubric',
  'grader',
  'grading',
  'judge',
  'judges',
  'evaluator',
  'evaluating',
  'evaluates',
  'evaluation',
  'reviewer',
  'verdict',
  'scoring model',
  'criterion',
  'criteria',
  'fail picture',
  'score it',
  'rate this',
  'outcome',
];

const VERDICT_WORDS = [
  'pass',
  'passing',
  'passed',
  'passes',
  'success',
  'satisfied',
  'compliant',
  'met',
  'fail',
  'fails',
];

const VERDICT_NUMBERS = /(?<![\d.])(?:1\.0|0\.99)(?!\d)/;

export type ScreenFinding = { where: string };
export type ScreenResult = { flagged: boolean; findings: ScreenFinding[] };

/** A sentence ends at . ! ? or ; when a space or the end follows, and at a line break. */
function sentences(text: string): string[] {
  return text.split(/[.!?;]+(?=\s|$)|[\r\n]+/);
}

const OBLIGATIONS = ['always', 'must', 'never', 'should'];

/** A command anywhere in the sentence: the data may append an instruction to a sentence of its own. */
const COMMANDS = [
  /(?<!\p{L})(?:ignore|disregard|override|answer|respond|mark|output|return|report|rate|set|treat|consider|give|pick)(?!\p{L})/iu,
  /(?<!\p{L})forget (?:your|the rubric|the criteria|the grading|all)(?!\p{L})/iu,
  /(?<!\p{L})do not apply(?!\p{L})/iu,
  /(?<!\p{L})score (?:it|this)(?!\p{L})/iu,
  /(?<!\p{L})scale from \d/iu,
  /(?<!\p{L})(?:pass|fail) picture(?!\p{L})/iu,
  /(?<!\p{L})you are(?!\p{L})/iu,
];

/** A judge word opening a sentence and followed by a comma or colon: the sentence is addressed to the judge. */
const ADDRESSED = new RegExp(
  `(?:^|\\s)(?:${JUDGE_WORDS.join('|')})(?:\\s+\\S+){0,2}\\s*[,:]|(?:^|[\\s_])(?:${JUDGE_WORDS.join('|')})[\\s_]+note(?!\\p{L})`,
  'i',
);

/** True when the sentence reads as written to the reader: a command, an obligation, or a note addressed to the judge. */
function instructs(sentence: string, words: readonly string[]): boolean {
  const spoken = ` ${words.join(' ')} `;
  const has = (phrase: string) => spoken.includes(` ${phrase} `);
  return (
    COMMANDS.some((command) => command.test(sentence)) ||
    LANGUAGE_WORDS.some((l) => l.command.some((p) => occurs(sentence.toLowerCase(), p))) ||
    OBLIGATIONS.some(has) ||
    ADDRESSED.test(sentence.trim())
  );
}

/**
 * The same three kinds of word in other languages: a judge word, a verdict word and a command. A phrase of
 * plain letters must match a whole word; a phrase written in another script matches as a part of a word, since
 * such text has no spaces to split on.
 */
const LANGUAGE_WORDS: readonly {
  judge: readonly string[];
  verdict: readonly string[];
  command: readonly string[];
}[] = [
  { judge: ['bewertungskriterien', 'bewertung'], verdict: ['bestanden'], command: ['ignoriere', 'antworte'] },
  { judge: ['rúbrica', 'evaluación'], verdict: ['aprobado'], command: ['ignora', 'responde'] },
  { judge: ['évaluation', 'grille'], verdict: [], command: ['réponds'] },
  { judge: ['griglia', 'valutazione'], verdict: ['superato'], command: ['ignora', 'rispondi'] },
  { judge: ['rubrica', 'avaliação'], verdict: ['aprovado'], command: ['responda'] },
  { judge: ['beoordelingscriteria', 'beoordeling'], verdict: ['geslaagd'], command: ['negeer', 'antwoord'] },
  { judge: ['kryteria', 'oceny'], verdict: ['zaliczone'], command: ['zignoruj', 'odpowiedz'] },
  { judge: ['ölçüt', 'değerlendirme'], verdict: ['geçti'], command: ['yok say', 'yanıtını ver'] },
  { judge: ['критери', 'оценки'], verdict: ['пройдено'], command: ['игнорируй', 'ответь'] },
  { judge: ['评分标准', '评分'], verdict: ['通过'], command: ['忽略', '直接回答'] },
  { judge: ['評価基準', '評価'], verdict: ['合格'], command: ['無視', '答えて'] },
  { judge: ['평가 기준', '평가'], verdict: ['통과'], command: ['무시', '답하세요'] },
  { judge: ['معايير', 'التقييم'], verdict: ['ناجح'], command: ['تجاهل', 'أجب'] },
  { judge: ['मानदंड', 'मूल्यांकन'], verdict: ['पास'], command: ['अनदेखा', 'उत्तर'] },
  { judge: ['bedömningskriterierna', 'bedömning'], verdict: ['godkänt'], command: ['ignorera', 'svara'] },
  { judge: ['rubrik', 'penilaian'], verdict: ['lulus'], command: ['abaikan', 'jawab'] },
];

/** True when a phrase occurs in the lowered text: on word boundaries for plain letters, as a part of a word otherwise. */
function occurs(lower: string, phrase: string): boolean {
  if (/^[ -~]+$/.test(phrase)) {
    return new RegExp(`(?<!\\p{L}|\\p{M})${phrase}(?!\\p{L}|\\p{M})`, 'iu').test(lower);
  }
  return lower.includes(phrase);
}

/** True when the sentence holds a judge word and a verdict word, each as a whole word or phrase, and instructs. */
function instructsJudge(sentence: string): boolean {
  const words = sentence.toLowerCase().match(/\p{L}+/gu) ?? [];
  const spoken = ` ${words.join(' ')} `;
  const has = (phrase: string) => spoken.includes(` ${phrase} `);
  const lower = sentence.toLowerCase();
  const judge = JUDGE_WORDS.some(has) || LANGUAGE_WORDS.some((l) => l.judge.some((p) => occurs(lower, p)));
  if (!judge) return false;
  const verdict =
    VERDICT_WORDS.some(has) ||
    VERDICT_NUMBERS.test(sentence) ||
    LANGUAGE_WORDS.some((l) => l.verdict.some((p) => occurs(lower, p)));
  if (!verdict) return false;
  return instructs(sentence, words);
}

/** A run of base64 characters, long enough to hide a sentence. */
const BASE64_RUN = /[A-Za-z0-9+/]{16,}={0,2}/g;

/** The text of every base64 run in the text, decoded: an instruction may be hidden as base64 in the data. */
function decodedRuns(text: string): string {
  return (text.match(BASE64_RUN) ?? []).map((run) => Buffer.from(run, 'base64').toString('utf8')).join('\n');
}

/** Lookalike letters read as the Latin letter they imitate. */
const LOOKALIKES: Readonly<Record<string, string>> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', і: 'i' };
/** Digits and symbols used in place of letters. */
const LEET: Readonly<Record<string, string>> = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't' };

/**
 * The text as a reader sees it once the disguises are undone: compatibility forms, invisible characters,
 * lookalike letters, leetspeak digits, and letters set apart by dots or spaces. Only a copy is folded, so a
 * number such as 1.0 still reads as a number in the raw text.
 */
function unfolded(text: string): string {
  const letters = text
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[аеорсі]/g, (c) => LOOKALIKES[c] ?? c);
  const leeted = letters.replace(/[43105 7]/g, (c) => LEET[c] ?? c);
  const dotted = leeted.replace(/(?:\p{L}\.){2,}\p{L}/gu, (run) => run.replace(/\./g, ''));
  return dotted.replace(/(?:\p{L} ){3,}\p{L}/gu, (run) => run.replace(/ /g, ''));
}

/**
 * The text with its escapes read: a hex run (0x...), HTML numeric entities, \uXXXX escapes and percent-encoding.
 * A value that does not decode is read as written.
 */
function unescaped(text: string): string {
  return text
    .replace(/0x((?:[0-9a-f]{2}){8,})/gi, (_, hex: string) => Buffer.from(hex, 'hex').toString('utf8'))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
}

function screenText(text: string): boolean {
  return [text, decodedRuns(text), unfolded(text), unescaped(text)].some((part) =>
    sentences(part).some(instructsJudge),
  );
}

/** The strings of a JSON-like value, keys included, each on its own line, so a sentence keeps its words. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) =>
      typeof inner === 'string' ? [`${key}: ${inner}`] : [key, ...stringLeaves(inner)],
    );
  return [];
}

/** The text of an entry: a JSON body is read as its strings, so its values and keys are sentences too. */
function readable(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    return stringLeaves(JSON.parse(trimmed)).join('\n');
  } catch {
    return text;
  }
}

/** Screens the observed data of a request: each transcript entry (read with its tool name), the artifact and the Given. */
export function screenData(request: JudgeRequest): ScreenResult {
  const findings: ScreenFinding[] = [];
  request.transcript.forEach((entry, index) => {
    const flagged = screenText(readable(entry.text)) || (entry.tool !== undefined && screenText(entry.tool));
    if (flagged) findings.push({ where: `transcript.${index}` });
  });
  if (request.artifact !== undefined && screenText(request.artifact)) findings.push({ where: 'artifact' });
  if (request.given !== undefined && screenText(stringLeaves(request.given).join('\n')))
    findings.push({ where: 'given' });
  return { flagged: findings.length > 0, findings };
}
