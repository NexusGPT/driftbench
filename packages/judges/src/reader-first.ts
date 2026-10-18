import type { RubricItem } from './assessment';
import type { JudgeClient } from './client';
import type { JudgeRequest, JudgeResult } from './contract';
import { type ReaderFeatures, readerFeatures } from './reader-first-features';

export const READER_FIRST_CRITERIA = ['structure', 'economy', 'directness', 'context', 'simplicity'] as const;
export type ReaderCriterion = (typeof READER_FIRST_CRITERIA)[number];
export type ReaderChoice = 'A' | 'B' | 'tie';
export type ReaderFirstOptions = {
  /** Explicit opt-in. This configuration is never selected by the default judge. */
  configuration: 'reader-first';
  language?: 'en' | 'zh';
  /** Minimum sum of the shorter reply's five score advantages (0 to 20). */
  judgeMargin?: number;
  /** Minimum difference in machine risk flags for the machine-only ablation. */
  featureMargin?: number;
  /** Minimum supported failure criteria in the longer reply. */
  minFailures?: number;
};
export const READER_FIRST_THRESHOLDS = Object.freeze({ judgeMargin: 4, featureMargin: 5, minFailures: 1 });
export type ReaderScore = {
  name: ReaderCriterion;
  a: number;
  b: number;
  quoteA: string;
  quoteB: string;
  reasoning: string;
};
export type ReaderBallot = { valid: boolean; items: ReaderScore[]; problems: string[] };

const instructions = [
  'Give each candidate a fulfillment score from 0 (fails) to 4 (fully meets).',
  'Judge the complete commissioned work, respecting its genre and explicit request.',
  'A long, fully developed piece can satisfy all five requirements. Length alone is never a defect.',
  'An outline or unexplained sketch is not a substitute for the requested complete piece.',
  'Do not penalize deliberate repetition explicitly requested by the writing brief, necessary technical terms explained locally, or literary form appropriate to the request.',
  'Machine measurements are fallible diagnostic hints; verify every claimed defect in the actual candidate.',
  'For EVERY item, evidence MUST contain a short exact quote from EACH candidate, formatted: A: exact quote || B: exact quote. Do not use ellipses, invented words, or quotes from the request. Keep each quote under 16 words or 32 Chinese characters. Reasoning is one short sentence. Do not return an overall winner.',
].join(' ');
const RUBRICS: readonly RubricItem[] = [
  {
    name: 'structure',
    rubric:
      'The work is well structured: clear progression, readable paragraphs, and useful headings or lists where the genre calls for them. A story needs narrative organization, not mandatory bullets.',
  },
  {
    name: 'economy',
    rubric:
      'The work avoids useless prose: every section advances the requested task, explanation or narrative. No filler, redundant restatements, repetitive argument or empty hedging. Necessary development and requested stylistic repetition are useful.',
  },
  {
    name: 'directness',
    rubric:
      'The work states its meaning directly and avoids litotes, such as not bad, not unimportant, no small, not without, 不无, 并非不, 不是没有. Ordinary negation and necessary factual uncertainty are not litotes.',
  },
  {
    name: 'context',
    rubric:
      'The work assumes zero unstated reader context. It introduces people and concepts, explains necessary acronyms and jargon, and does not rely on a previous discussion or unexplained referent. Evaluate the piece as a reader would receive it; the request defines the assignment but is not a substitute for missing explanation in the piece.',
  },
  {
    name: 'simplicity',
    rubric:
      'The work is understandable to an inexperienced reader who needs plain words, explicit connections and concrete explanations. Avoid dense syntax and needless abstraction. Do not patronize the reader or reward a short incomplete sketch. Preserve the requested genre.',
  },
];

export function readerRiskFlags(f: ReaderFeatures): Record<ReaderCriterion, boolean> {
  return {
    structure:
      f.length > 500 &&
      f.headings + f.listItems === 0 &&
      (f.paragraphs <= 1 || f.meanParagraphLength > (f.language === 'zh' ? 400 : 250)),
    economy:
      f.fillerDensity + f.hedgeDensity > 6 || f.repeatedSentenceRatio > 0.08 || f.ngramRedundancy > 0.15,
    directness: f.litotesDensity > 1,
    context: f.undefinedAcronymDensity > 3 || f.jargonDensity > 3 || f.contextReferenceDensity > 1,
    simplicity:
      f.meanSentenceLength > (f.language === 'zh' ? 60 : 35) ||
      (f.readabilityGrade !== null && f.readabilityGrade > 14),
  };
}

export function readerFirstRequest(
  question: string,
  a: string,
  b: string,
  language?: 'en' | 'zh',
): JudgeRequest {
  const pairLanguage = language ?? readerFeatures(`${a}\n${b}`).language;
  const features = { A: readerFeatures(a, pairLanguage), B: readerFeatures(b, pairLanguage) };
  return {
    criterion: { name: 'reader-first', rubric: instructions },
    assessment: { kind: 'rubric', pairwise: true, items: RUBRICS },
    candidates: { A: a, B: b },
    transcript: [
      { role: 'user', text: question },
      { role: 'context', text: `Machine features (heuristics, not verdicts): ${JSON.stringify(features)}` },
    ],
    artifact: `Reply A:\n${a}\n\nReply B:\n${b}`,
  };
}

/** Require both source quotes, each score, and each criterion exactly once. */
export function readerBallot(result: JudgeResult, a: string, b: string): ReaderBallot {
  const items: ReaderScore[] = [];
  const problems: string[] = [];
  if (result.unparsed || !result.rubric)
    return { valid: false, items, problems: ['missing or unparsed rubric'] };
  for (const name of READER_FIRST_CRITERIA) {
    const matches = result.rubric.items.filter((item) => item.name === name);
    const item = matches[0];
    if (matches.length !== 1 || !item) {
      problems.push(`${name}: missing or duplicate`);
      continue;
    }
    const parts = item.evidence?.match(/^A:\s*([\s\S]+?)\s*\|\|\s*B:\s*([\s\S]+)$/);
    const clean = (s: string) => s.trim().replace(/^["“]|["”]$/g, '');
    const quoteA = clean(parts?.[1] ?? '');
    const quoteB = clean(parts?.[2] ?? '');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (!quoteA || !quoteB || !norm(a).includes(norm(quoteA)) || !norm(b).includes(norm(quoteB))) {
      problems.push(`${name}: evidence does not quote both candidates`);
      continue;
    }
    if (
      typeof item.first !== 'number' ||
      typeof item.second !== 'number' ||
      !Number.isInteger(item.first) ||
      !Number.isInteger(item.second) ||
      Math.min(item.first, item.second) < 0 ||
      Math.max(item.first, item.second) > 4
    ) {
      problems.push(`${name}: invalid score`);
      continue;
    }
    items.push({ name, a: item.first, b: item.second, quoteA, quoteB, reasoning: item.reasoning });
  }
  if (result.rubric.items.length !== 5) problems.push('extra criteria');
  return { valid: problems.length === 0 && items.length === 5, items, problems };
}

export function resolveReaderFirst(
  a: ReaderFeatures,
  b: ReaderFeatures,
  ordered: ReaderBallot,
  swapped: ReaderBallot,
  options: ReaderFirstOptions,
) {
  if (options.configuration !== 'reader-first')
    throw new RangeError('reader-first requires explicit configuration');
  const thresholds = { ...READER_FIRST_THRESHOLDS, ...options };
  for (const key of ['judgeMargin', 'featureMargin', 'minFailures'] as const) {
    if (!Number.isFinite(thresholds[key]) || thresholds[key] <= 0)
      throw new RangeError(`${key} must be positive and finite`);
  }
  const length: ReaderChoice = a.length === b.length ? 'tie' : a.length > b.length ? 'A' : 'B';
  const flags = { A: readerRiskFlags(a), B: readerRiskFlags(b) };
  const risks = (side: 'A' | 'B') => Object.values(flags[side]).filter(Boolean).length;
  const longer = length === 'B' ? 'B' : 'A';
  const shorter = longer === 'A' ? 'B' : 'A';
  const featureGap = risks(longer) - risks(shorter);
  const features: ReaderChoice =
    length !== 'tie' && featureGap >= thresholds.featureMargin ? shorter : length;
  const judgeValid = ordered.valid && swapped.valid;
  const means = READER_FIRST_CRITERIA.map((name) => {
    const ab = ordered.items.find((x) => x.name === name);
    const ba = swapped.items.find((x) => x.name === name);
    return { name, A: ab && ba ? (ab.a + ba.b) / 2 : 0, B: ab && ba ? (ab.b + ba.a) / 2 : 0 };
  });
  const judgeGap = means.reduce((sum, x) => sum + x[shorter] - x[longer], 0);
  const failures = means
    .filter((x) => x[longer] <= 2 && x[shorter] >= 3 && flags[longer][x.name] && !flags[shorter][x.name])
    .map((x) => x.name);
  const override =
    length !== 'tie' &&
    judgeValid &&
    judgeGap >= thresholds.judgeMargin &&
    failures.length >= thresholds.minFailures;
  return {
    configuration: 'reader-first' as const,
    lengthAware: true as const,
    length,
    features,
    choice: override ? shorter : length,
    override,
    judgeValid,
    flags,
    featureGap,
    judgeGap,
    failures,
    means,
    thresholds,
  };
}

/** Explicit opt-in pair configuration. Both presentations are judged sequentially, then code decides. */
export function createReaderFirstJudge(client: JudgeClient, options: ReaderFirstOptions) {
  // Validate before any paid call.
  resolveReaderFirst(
    readerFeatures(''),
    readerFeatures(''),
    { valid: false, items: [], problems: [] },
    { valid: false, items: [], problems: [] },
    options,
  );
  return {
    id: 'reader-first' as const,
    lengthAware: true as const,
    async judgePair(question: string, a: string, b: string) {
      const language = options.language ?? readerFeatures(`${a}\n${b}`).language;
      const features = { A: readerFeatures(a, language), B: readerFeatures(b, language) };
      const ab = await client.judge(readerFirstRequest(question, a, b, options.language));
      const ba = await client.judge(readerFirstRequest(question, b, a, options.language));
      const ordered = readerBallot(ab, a, b);
      const swapped = readerBallot(ba, b, a);
      return {
        ...resolveReaderFirst(features.A, features.B, ordered, swapped, options),
        machine: features,
        ordered,
        swapped,
        calls: 2,
        costUsd: (ab.costUsd ?? 0) + (ba.costUsd ?? 0),
        // Set when a call's cost is unknown: costUsd is then a lower bound.
        ...(ab.costIncomplete || ba.costIncomplete ? { costIncomplete: true as const } : {}),
      };
    },
  };
}
