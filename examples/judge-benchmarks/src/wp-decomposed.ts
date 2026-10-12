import { z } from 'zod';
import type { PairDecision, Prompt } from './contestants';
import { parseJudgeText, parseJudgeValue, type RubricItem } from './shared-judge-arch/assessment';
import {
  extractObject,
  type JudgeRequest,
  type JudgeResult,
  repairAnswerText,
} from './shared-judge-arch/contract';
import { buildPrompt, dataTag } from './shared-judge-arch/prompt';

/** Fixed before any criterion-scoring run. Requirement count cannot change its total weight. */
export const DECOMPOSED_CONFIG = Object.freeze({
  version: 'request-blind-atomic-v1',
  weights: Object.freeze({ requirements: 0.45, development: 0.35, craft: 0.2 }),
  batchSize: 4,
  repairAttempts: 1,
  orderPolicy: 'independent-games' as const,
});

const positive = z.string().trim().min(1);
export const WritingBrief = z.strictObject({
  requirements: z.array(z.strictObject({ requirement: positive, sourceQuote: positive })).min(1),
  development: positive,
  craft: positive,
});
export type WritingBrief = z.infer<typeof WritingBrief>;

/** This API takes only the request, so neither response nor its gold label can shape the criteria. */
export function deriveWritingBrief(question: string): Prompt {
  return {
    system: [
      'Read a writing request and derive the criteria for assessing its fulfillment. You have no candidate replies.',
      'Extract every explicit requirement as a separate positive, assessable requirement. Include the requested artifact, topics, constraints, audience, tone, perspective, and ending. Keep genuinely distinct requirements separate; do not repeat them.',
      'Copy a short exact source quote for every explicit requirement. Do not add unstated factual claims or resolve ambiguous wording by inventing a constraint.',
      'Derive two separate genre-specific quality criteria: development (how effectively ideas, evidence, characters or practical details realize the brief) and craft (coherent structure, voice, transitions, originality and consistency appropriate to the audience).',
      'For fiction, judge enactment, causality, tension and earned emotional change; invented fictional details are allowed. For a practical artifact, judge usable concrete explanation, internal consistency and responsibly framed assumptions. For factual analysis, judge supported interpretation and accurate details.',
      'Use no text-size proxy or preference. A topic being mentioned is not the same as being developed.',
      'Return only JSON: {"requirements":[{"requirement":"one positive requirement","sourceQuote":"exact quote from request"}],"development":"genre-specific criterion","craft":"genre-specific criterion"}. No weights, scores, winner or additional keys.',
    ].join('\n'),
    user: dataTag('input_data', question),
  };
}

/** The shared object extraction and quote repair are reused; Zod validates this setup-only schema. */
export function parseWritingBrief(raw: string, question: string): WritingBrief | undefined {
  const text = extractObject(raw);
  if (text === undefined) return undefined;
  for (const candidate of [text, repairAnswerText(text)]) {
    try {
      const parsed = WritingBrief.safeParse(JSON.parse(candidate));
      if (!parsed.success) continue;
      const brief = parsed.data;
      if (brief.requirements.some((r) => !question.includes(r.sourceQuote))) return undefined;
      if (
        new Set(brief.requirements.map((r) => r.requirement.toLowerCase())).size !== brief.requirements.length
      )
        return undefined;
      return brief;
    } catch {
      /* A setup repair cannot invent a missing requirement or a source quote. */
    }
  }
  return undefined;
}

export function writingCriteria(brief: WritingBrief): RubricItem[] {
  return [
    ...brief.requirements.map((r, i) => ({
      name: `requirement-${i + 1}`,
      rubric: r.requirement,
      weight: DECOMPOSED_CONFIG.weights.requirements / brief.requirements.length,
    })),
    { name: 'development', rubric: brief.development, weight: DECOMPOSED_CONFIG.weights.development },
    { name: 'craft', rubric: brief.craft, weight: DECOMPOSED_CONFIG.weights.craft },
  ];
}

export function criterionRequest(
  question: string,
  a: string,
  b: string,
  items: readonly RubricItem[],
): JudgeRequest {
  return {
    criterion: {
      name: 'Writing brief fulfillment',
      rubric: 'Score the supplied writing criteria independently using evidence from each reply.',
      scope: 'block',
    },
    assessment: { kind: 'rubric', pairwise: true, items },
    candidates: { A: a, B: b },
    transcript: [
      { role: 'user', text: question },
      { role: 'context', text: `Reply A: ${a}` },
      { role: 'context', text: `Reply B: ${b}` },
    ],
  };
}

export function criterionPrompt(request: JudgeRequest, repair = false): Prompt {
  const prompt = buildPrompt(request);
  return repair
    ? {
        ...prompt,
        user: `${prompt.user}\nYour previous response broke the assessment contract. Return a complete JSON object with exactly the requested item names and integer scores for each candidate. Do not supply an overall verdict.`,
      }
    : prompt;
}

/** Uses the reviewed shared contract, with no terminal-ballot or binary-outcome fallback. */
export const parseCriterionScores = parseJudgeText;

/** Shared deterministic rubric aggregation is the only source of a verdict. */
export function aggregateCriteria(request: JudgeRequest, parts: readonly JudgeResult[]): JudgeResult {
  if (parts.some((part) => part.unparsed || !part.rubric))
    return {
      raw: '',
      answer: { outcome: 'inconclusive', reasoning: 'a criterion score is missing or invalid' },
      unparsed: true,
    };
  return parseJudgeValue(
    {
      items: parts.flatMap((part) =>
        part.rubric!.items.map((item) => ({
          name: item.name,
          a: item.first,
          b: item.second,
          reasoning: item.reasoning,
          ...(item.evidence === undefined ? {} : { evidence: item.evidence }),
        })),
      ),
    },
    request,
  );
}

export function scoredWinner(result: JudgeResult): PairDecision {
  return !result.unparsed && (result.winner === 'A' || result.winner === 'B') ? result.winner : 'tie';
}
