import type { JudgeRequest } from './contract';

/** Where an instruction to the judge sits: `transcript.<index>`, `artifact` or `given`. */
export type ScreenFinding = { readonly where: string };

/** What `screenData` returns: whether any place holds an instruction to the judge, and which. */
export type ScreenReport = { readonly flagged: boolean; readonly findings: readonly ScreenFinding[] };

const JUDGE_WORDS = [
  'rubric',
  'grader',
  'grading',
  'judges?',
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
/** Judge and verdict words of other languages, one row per language. A sentence is an instruction when it holds a judge word and a verdict word of the same list. */
const OTHER_LANGUAGES: readonly {
  readonly judge: readonly string[];
  readonly verdict: readonly string[];
  /** A script without spaces between words, or with suffixes on them: the words match anywhere in a sentence. */
  readonly loose?: boolean;
}[] = [
  {
    // French
    judge: [
      "grille d['\u2019\\s]*[eé]?[\\s\u0301]*valuation",
      '[ée]valuateur',
      'juge',
      'crit[èe]res?',
      'rubrique',
      'verdict',
      'r[ée]sultat',
    ],
    verdict: [
      'r[ée]ussi[et]?',
      'r[ée]ussite',
      'valid[ée]e?',
      'conforme',
      'satisfait',
      '[ée]chec',
      '[ée]chou[ée]e?',
    ],
  },
  {
    // Spanish
    judge: ['r[úu]brica', 'criterios? de evaluaci[óo]n', 'evaluador', 'juez', 'veredicto', 'calificador'],
    verdict: [
      'aprobado',
      'aprobada',
      'aprueba',
      '[ée]xito',
      'cumple',
      'satisfecho',
      'suspendido',
      'reprobado',
      'fallo',
    ],
  },
  {
    // German
    judge: ['Bewertungskriterien', 'Bewertung', 'Bewerter', 'Richter', 'Urteil', 'Kriterien', 'Rubrik'],
    verdict: [
      'bestanden',
      'besteht',
      'erfolgreich',
      'erf[üu]llt',
      'konform',
      'durchgefallen',
      'nicht bestanden',
    ],
  },
  {
    // Italian
    judge: [
      'griglia di valutazione',
      'rubrica',
      'valutatore',
      'giudice',
      'criteri di valutazione',
      'verdetto',
    ],
    verdict: [
      'superato',
      'superata',
      'supera',
      'approvato',
      'approvata',
      'successo',
      'conforme',
      'soddisfatto',
      'fallito',
      'non superato',
    ],
  },
  {
    // Portuguese
    judge: [
      'rubrica',
      'avalia[çc][ãa]o',
      'avaliador',
      'juiz',
      'crit[ée]rios? de avalia[çc][ãa]o',
      'veredito',
    ],
    verdict: ['aprovado', 'aprovada', 'aprova', 'sucesso', 'conforme', 'satisfeito', 'reprovado', 'falha'],
  },
  {
    // Dutch
    judge: ['beoordelingscriteria', 'beoordelaar', 'rechter', 'criteria', 'rubriek', 'oordeel'],
    verdict: ['geslaagd', 'slaagt', 'voldoet', 'succes', 'gefaald', 'niet geslaagd', 'goedgekeurd'],
  },
  {
    // Polish
    judge: [
      'kryteri[aó]w? oceny',
      'kryteria',
      'ocena',
      'oceniaj[ąa]cy',
      's[ęe]dzia',
      'werdykt',
      'rubryk[ia]',
    ],
    verdict: [
      'zaliczone',
      'zaliczony',
      'zaliczona',
      'zdane',
      'zdany',
      'pozytywn[aey]',
      'sukces',
      'niezaliczone',
      'oblane',
    ],
  },
  {
    // Turkish
    judge: ['de[ğg]erlendirme', '[öo]l[çc][üu]t\\p{L}*', 'hakem', 'kriter\\p{L}*', 'karar'],
    verdict: ['ge[çc]ti', 'ge[çc]er', 'ba[şs]ar[ıi]l[ıi]', 'kald[ıi]', 'ba[şs]ar[ıi]s[ıi]z'],
  },
  {
    // Russian
    judge: ['критери\\p{L}*', 'оценк\\p{L}*', 'оценива\\p{L}*', 'судь[яи]', 'вердикт\\p{L}*'],
    verdict: [
      'пройден\\p{L}*',
      'зачт\\p{L}*',
      'успешн\\p{L}*',
      'провал\\p{L}*',
      'одобрен\\p{L}*',
      'принят\\p{L}*',
    ],
  },
  {
    // Chinese
    loose: true,
    judge: ['评分标准', '评估标准', '评判', '评分', '裁判', '评审'],
    verdict: ['通过', '合格', '成功', '不及格', '失败'],
  },
  {
    // Japanese
    loose: true,
    judge: ['評価基準', '評価', '採点', '審査', '判定'],
    verdict: ['合格', '成功', '失敗', 'パス', '通過'],
  },
  {
    // Korean
    loose: true,
    judge: ['평가 기준', '평가', '채점', '심사', '판정'],
    verdict: ['통과', '합격', '성공', '실패'],
  },
  {
    // Arabic
    loose: true,
    judge: ['معايير التقييم', 'التقييم', 'المقي\u0651\u0645', 'المقيم', 'القاضي', 'الحكم'],
    verdict: ['ناجح', 'نجاح', 'ينجح', 'رسب', 'فشل'],
  },
  {
    // Swedish
    judge: [
      'bed[öo]mningskriterier\\p{L}*',
      'bed[öo]mning\\p{L}*',
      'domare\\p{L}*',
      'kriterier\\p{L}*',
      'betyg\\p{L}*',
      'rubrik\\p{L}*',
    ],
    verdict: ['godk[äa]nt', 'godk[äa]nd\\p{L}*', 'klarat', 'underk[äa]nt', 'lyckad\\p{L}*'],
  },
  {
    // Indonesian
    judge: ['rubrik', 'penilaian', 'penilai', 'juri', 'kriteria'],
    verdict: ['lulus', 'berhasil', 'gagal', 'sukses'],
  },
  {
    // Hindi
    loose: true,
    judge: ['मूल्यांकन', 'मानदंड', 'न्यायाधीश', 'निर्णायक'],
    verdict: ['पास', 'उत्तीर्ण', 'असफल', 'सफल', 'फेल'],
  },
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

// A word starts and ends at a character that is not a letter, so _ / - % . and digits separate words.
const phrase = (words: readonly string[]) =>
  new RegExp(`(?<!\\p{L})(?:${words.map((word) => word.replace(/ /g, '\\s+')).join('|')})(?!\\p{L})`, 'iu');
const loosely = (words: readonly string[]) =>
  new RegExp(words.map((word) => word.replace(/ /g, '\\s*')).join('|'), 'iu');
type Words = { judge: RegExp; verdict: RegExp };
// Built on the first screen, not at import: constructing the unicode patterns of every language costs a few
// milliseconds that a process which never screens a text should not pay.
let words: { english: Words; other: readonly Words[] } | undefined;
const wordPatterns = () =>
  (words ??= {
    english: { judge: phrase(JUDGE_WORDS), verdict: phrase(VERDICT_WORDS) },
    other: OTHER_LANGUAGES.map((row) =>
      row.loose
        ? { judge: loosely(row.judge), verdict: loosely(row.verdict) }
        : { judge: phrase(row.judge), verdict: phrase(row.verdict) },
    ),
  });
const SCORE = /(?<![\d.])(?:1\.0|0\.99)(?!\d)/;

const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?;])\s+|(?<=[\u3002\uff01\uff1f\uff1b\u0964])|[\r\n\u2028\u2029]+/);

// An English sentence instructs when it holds a modal or an imperative verb at the start of a clause, is a note or
// a vocative to the judge (up to three words before a comma or colon, one a judge word), or sets a verdict field.
const MODAL =
  /(?<!\p{L})(?:must|should|shall|has to|have to|needs? to|ought to|always|never|allowed to|required to|supposed to|forbidden|is to|are to|may not|you(?:'re| are| will))(?!\p{L})/iu;
const IMPERATIVE_VERBS: readonly string[] = [
  'do not',
  "don't",
  'ignore',
  'disregard',
  'forget',
  'override',
  'bypass',
  'return',
  'output',
  'answer',
  'respond',
  'reply',
  'mark',
  'score',
  'rate',
  'grade',
  'set',
  'give',
  'say',
  'report',
  'treat',
  'consider',
  'assign',
  'declare',
  'conclude',
  'ensure',
  'make',
  'pass',
  'fail',
  'print',
  'write',
  'state',
  'emit',
  'submit',
  'pick',
  'choose',
  'approve',
  'accept',
  'count',
  'regard',
  'assume',
  'apply',
  'skip',
  'stop',
  'certify',
  'record',
  'label',
  'flag',
  'select',
  'iu',
];
const VERB_ALTERNATIVES = IMPERATIVE_VERBS.map((verb) => verb.replace(/ /g, '\\s+')).join('|');
// A verb at the start of a clause, in any case, or a capitalised verb anywhere (data is planted after other text).
const IMPERATIVE = new RegExp(
  `(?:^|[,:;]\\s*|(?<!\\p{L})(?:and|then|please)\\s+)(?:${VERB_ALTERNATIVES})(?!\\p{L})`,
  'iu',
);
const IMPERATIVE_CAPITALISED = new RegExp(
  `(?<!\\p{L})(?:${VERB_ALTERNATIVES.replace(/(^|\|)([a-z])/g, (_, bar: string, ch: string) => bar + ch.toUpperCase())})(?!\\p{L})`,
  'u',
);
const NOTE =
  /(?<!\p{L})(?:instructions?|(?:judges?|graders?|evaluators?|reviewers?) notes?|notes? (?:to|for)|important (?:to|for)|messages? (?:to|for)|system prompt|(?:pass|fail) pictures?|new (?:criterion|criteria|rubric)|(?:this|the) (?:reply|response|transcript|conversation|log))(?!\p{L})/iu;
const FIELD =
  /(?<!\p{L})(?:verdict|outcome|score|result)\W{0,3}[=:]\W{0,3}(?:pass|passed|success|1\.0|0\.99)/iu;
const instructive = (sentence: string): boolean => {
  const JUDGE = wordPatterns().english.judge;
  const vocative = [...sentence.matchAll(/([^,:]*)[,:]/g)].some(([, lead]) =>
    JUDGE.test((lead ?? '').trim().split(/\s+/).slice(-3).join(' ')),
  );
  return (
    MODAL.test(sentence) ||
    IMPERATIVE.test(sentence) ||
    IMPERATIVE_CAPITALISED.test(sentence) ||
    NOTE.test(sentence) ||
    FIELD.test(sentence) ||
    vocative
  );
};
const instructs = (sentence: string): boolean => {
  const { english, other } = wordPatterns();
  const JUDGE = english.judge;
  const VERDICT = english.verdict;
  return (
    (JUDGE.test(sentence) && (VERDICT.test(sentence) || SCORE.test(sentence)) && instructive(sentence)) ||
    other.some(
      (row) =>
        row.judge.test(sentence) &&
        (row.verdict.test(sentence) ||
          ((VERDICT.test(sentence) || SCORE.test(sentence)) && !JUDGE.test(sentence))),
    )
  );
};

/** The letters a-z moved `by` places along the alphabet, case kept; other characters stay. */
const shift = (text: string, by: number): string =>
  text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + by) % 26) + base);
  });

const LEET: Readonly<Record<string, string>> = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't' };

const LOOKALIKES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    a: '\u0430',
    c: '\u0441',
    e: '\u0435',
    i: '\u0456',
    j: '\u0458',
    o: '\u043e',
    p: '\u0440',
    s: '\u0455',
    x: '\u0445',
    y: '\u0443',
    A: '\u0410',
    B: '\u0412',
    C: '\u0421',
    E: '\u0415',
    H: '\u041d',
    K: '\u041a',
    M: '\u041c',
    O: '\u041e',
    P: '\u0420',
    T: '\u0422',
    X: '\u0425',
  }).map(([latin, cyrillic]) => [cyrillic, latin]),
);

/**
 * The readings of a text a screen looks at: the text as written, then each way a writer can hide words in it. Each
 * reading is a whole text that is split into sentences like the original.
 */
const READINGS: readonly ((text: string) => string | undefined)[] = [
  // Characters that print nothing, dropped: zero-width marks, the soft hyphen, the word joiner, the byte order mark.
  (text) => {
    const bare = text.replace(/[\u200b-\u200f\u00ad\u2060-\u2064\ufeff\u180e]/g, '');
    return bare === text ? undefined : bare;
  },
  // Cyrillic letters that look like Latin ones, folded inside a word that also holds Latin letters (mixed script).
  (text) => {
    const folded = text.replace(/[\p{L}\p{M}]+/gu, (word) =>
      /[a-z]/i.test(word) ? [...word].map((ch) => LOOKALIKES[ch] ?? ch).join('') : word,
    );
    return folded === text ? undefined : folded;
  },
  // Leetspeak: digits read as the letters they stand for, inside a word that also holds letters.
  (text) => {
    const folded = text.replace(/[\p{L}\p{N}]+/gu, (word) =>
      /\p{L}/u.test(word) ? [...word].map((ch) => LEET[ch] ?? ch).join('') : word,
    );
    return folded === text ? undefined : folded;
  },
  // Letters spaced one by one (i g n o r e): the single spaces between letters are dropped.
  (text) => {
    const joined = text.replace(/(?<=\p{L}) (?=\p{L}(?: |$|[^\p{L}]))/gu, '');
    return joined === text ? undefined : joined;
  },
  // Letters separated by dots (i.g.n.o.r.e): the dots between letters are dropped.
  (text) => {
    const joined = text.replace(/(?<=\p{L})\.(?=\p{L})/gu, '');
    return joined === text ? undefined : joined;
  },
  // The text read backwards, line by line is not needed: instructions are written on one line.
  (text) => [...text].reverse().join(''),
  // ROT13: each letter moved 13 places along the alphabet.
  (text) => shift(text, 13),
  // File names written as a slug (words joined by - _ / or by capitals), each read as a sentence of its own.
  (text) => {
    const words = (slug: string) =>
      slug
        .replace(/\.[a-z0-9]{1,5}$/i, '')
        .replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' ')
        .replace(/[_\-/]+/g, ' ');
    const split = text.replace(
      /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}]+(?:[_\-/][\p{L}\p{N}]+){3,}|(?:\p{Lu}\p{Ll}+){4,})(?:\.[a-z0-9]{1,5})?(?![\p{L}\p{N}])/gu,
      (slug) => `. ${words(slug)}. `,
    );
    return split === text ? undefined : split;
  },
  // The 24 Caesar shifts other than 13, of each sentence (up to 6000 characters in all): one line per shift.
  (text) => {
    const short = sentencesOf(text).filter((sentence) => sentence.length >= 8);
    if (short.reduce((sum, sentence) => sum + sentence.length, 0) > 6000) return undefined;
    const body = short.join('\n');
    return Array.from({ length: 25 }, (_, i) => shift(body, i + 1))
      .filter((_, i) => i + 1 !== 13)
      .join('\n');
  },
  // Compatibility forms: fullwidth letters and the like read as plain letters.
  (text) => {
    const folded = text.normalize('NFKC');
    return folded === text ? undefined : folded;
  },
];

/** The text of some bytes when they are UTF-8 and at least 90 percent of the characters print. */
const readable = (bytes: Uint8Array): string | undefined => {
  try {
    const out = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const printable = [...out].filter((ch) => /[\p{L}\p{N}\p{P}\p{Z}]/u.test(ch)).length;
    return printable >= 0.9 * [...out].length ? out : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Encodings undone before the other readings: each result is screened as written and again through every reading
 * (a base64 text that holds ROT13).
 */
const DECODERS: readonly ((text: string) => string | undefined)[] = [
  // Base64 runs of 16 characters or more, replaced by the text they decode to when it is readable UTF-8.
  (text) => {
    const decoded = text.replace(
      /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{16,}={0,2}(?![A-Za-z0-9+/=_-])/g,
      (run) => readable(Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64')) ?? run,
    );
    return decoded === text ? undefined : decoded;
  },
  // \uXXXX escapes, four or more in a row: read as the characters they stand for.
  (text) => {
    const decoded = text.replace(/(?:\\u[0-9a-f]{4}){4,}/gi, (run) =>
      run.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
    );
    return decoded === text ? undefined : decoded;
  },
  // Percent escapes (%20, %C3%BA), when the text holds four or more: read as the characters they stand for.
  (text) => {
    if ((text.match(/%[0-9a-f]{2}/gi) ?? []).length < 4) return undefined;
    const decoded = text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    return decoded === text ? undefined : decoded;
  },
  // Runs of eight or more 8-bit binary groups: the bytes read as UTF-8.
  (text) => {
    const decoded = text.replace(/(?<![01])(?:[01]{8}(?:\s+|$|(?![01]))){8,}/g, (run) => {
      const bytes = Uint8Array.from(
        run
          .trim()
          .split(/\s+/)
          .map((group) => Number.parseInt(group, 2)),
      );
      return readable(bytes) ?? run;
    });
    return decoded === text ? undefined : decoded;
  },
  // HTML numeric entities (&#65; and &#x41;): read as the characters they stand for.
  (text) => {
    const decoded = text.replace(
      /&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi,
      (entity, hex?: string, dec?: string) => {
        const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      },
    );
    return decoded === text ? undefined : decoded;
  },
  // Hexadecimal runs written 0x...: the bytes read as UTF-8.
  (text) => {
    const decoded = text.replace(
      /(?<![\p{L}\p{N}])0x((?:[0-9a-f]{2}){8,})(?![\p{L}\p{N}])/giu,
      (run, hex: string) => readable(Buffer.from(hex, 'hex')) ?? run,
    );
    return decoded === text ? undefined : decoded;
  },
];

const readingsOf = (text: string, depth = 2): string[] => {
  const readings = (t: string) => READINGS.map((read) => read(t)).filter((r): r is string => r !== undefined);
  const decoded =
    depth === 0 ? [] : DECODERS.map((decode) => decode(text)).filter((r): r is string => r !== undefined);
  return [text, ...readings(text), ...decoded.flatMap((d) => readingsOf(d, depth - 1))];
};

/**
 * Screens a request before a judge reads it. Every sentence (split after . ! ? ; and at line breaks) of each place is
 * read: each transcript entry with its tool name, the artifact, and the Given as JSON. A sentence that holds a judge
 * word and a verdict word is an instruction to the judge, and its place is a finding.
 */
export function screenData(request: JudgeRequest): ScreenReport {
  const places: [string, string][] = [
    ...request.transcript.map((entry, i): [string, string] => [
      `transcript.${i}`,
      entry.tool ? `${entry.tool}\n${entry.text}` : entry.text,
    ]),
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
  ];
  const findings = places
    .filter(([, text]) => readingsOf(text).some((reading) => sentencesOf(reading).some(instructs)))
    .map(([where]) => ({ where }));
  return { flagged: findings.length > 0, findings };
}
