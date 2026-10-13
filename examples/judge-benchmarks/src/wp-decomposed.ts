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
  version: 'request-blind-single-reply-v3',
  weights: Object.freeze({ requirements: 0.45, development: 0.35, craft: 0.2 }),
  batchSize: 'all' as const,
  repairAttempts: 1,
  orderPolicy: 'independent-scorecard-reuse' as const,
});

const positive = z.string().trim().min(1);
export const WritingBrief = z.strictObject({
  requirements: z
    .array(z.strictObject({ requirement: positive, sourceQuote: positive, mandatory: z.boolean() }))
    .min(1),
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
      'Keep proper names and locations exactly as the request writes them, including their original script. A threat or an attempted bribe is not a requirement that the protagonist accepts it. Preserve modal distinctions: an allowed option is not mandatory.',
      'Set mandatory=false for suggestions, permission, optional examples and alternative techniques; only mandatory=true items will receive requirement weight. For a title given inside quotation or book-title marks, require the title wording, not those enclosing marks unless their literal reproduction is explicitly requested.',
      'Derive two separate genre-specific quality criteria: development (how effectively ideas, evidence, characters or practical details realize the brief) and craft (coherent structure, voice, transitions, originality and consistency appropriate to the audience).',
      'For fiction, judge enactment, causality, tension and earned emotional change; invented fictional details are allowed. For a practical artifact, judge usable concrete explanation, internal consistency and responsibly framed assumptions. For factual analysis, judge supported interpretation and accurate details.',
      'Quality criteria must not add plot events, sources, viewpoint changes, platform markers or promotional calls to action that the commission does not request. A requested tone or inner struggle can evolve into an earned resolution. Derive quality criteria from the intended reader experience, not from a generic publication template.',
      'Use no text-size proxy or preference. A topic being mentioned is not the same as being developed.',
      'Return only JSON: {"requirements":[{"requirement":"one positive requirement","sourceQuote":"exact quote from request","mandatory":true}],"development":"genre-specific criterion","craft":"genre-specific criterion"}. No weights, scores, winner or additional keys.',
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
  const required = brief.requirements.filter((r) => r.mandatory);
  if (!required.length) throw new RangeError('a writing brief needs a mandatory artifact requirement');
  return [
    ...required.map((r, i) => ({
      name: `requirement-${i + 1}`,
      rubric: `${r.requirement} Source phrase: ${r.sourceQuote}`,
      weight: DECOMPOSED_CONFIG.weights.requirements / required.length,
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

/** A scorer of one reply cannot anchor its score to the competing reply's position or wording. */
export function singleReplyRequest(
  question: string,
  reply: string,
  items: readonly RubricItem[],
): JudgeRequest {
  return {
    criterion: {
      name: 'Writing brief fulfillment',
      rubric: 'Score the supplied writing criteria independently using evidence from the reply.',
      scope: 'block',
    },
    assessment: { kind: 'rubric', items },
    transcript: [
      { role: 'user', text: question },
      { role: 'agent', text: reply },
    ],
  };
}

export function criterionPrompt(request: JudgeRequest, repair = false): Prompt {
  const prompt = buildPrompt(request);
  prompt.user +=
    '\nFor each criterion, finish the evidence and reasoning first, then write the final numeric score fields. If you revise an interpretation, update those numbers to match your final reasoning. A name or section merely being present does not establish its effective development.';
  prompt.user += [
    '\nThe original commission governs every supplied criterion. Do not impose literal enclosing title marks, optional material, platform markers, a citation apparatus, viewpoint changes or an unchanged emotional state unless requested.',
    'For content requirements, distinguish identifying a topic from developing it through an explanation, procedure, argument or consequential scene. For quality criteria, anchor 1 to major failures of the requested experience, 2 to mixed execution, 3 to effective execution with specific minor weaknesses, and 4 to fully realized execution supported by the text.',
    'A synopsis can supply planned events, but planned or asserted scenes do not demonstrate enacted dialogue, tension or emotional payoff. Assess the requested artifact; a commission to devise a concept can be fulfilled by a plan.',
    'A practical template with unspecified product facts can responsibly leave values open. Invented specifications, service commitments or contacts presented as verified do not earn usable-detail credit. A factual concern must identify a demonstrable contradiction or a well-established correction; uncertainty alone is not proof of an error. Apply the same standard to hypothetical examples and to asserted facts.',
  ].join('\n');
  return repair
    ? {
        ...prompt,
        user: `${prompt.user}\nYour previous response broke the assessment contract. Return a complete JSON object with exactly the requested item names and integer scores for each candidate. Do not supply an overall verdict.`,
      }
    : prompt;
}

/** Uses the owner-approved shared score contract, with no terminal-ballot or binary-outcome fallback. */
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

export function aggregateSingle(request: JudgeRequest, parts: readonly JudgeResult[]): JudgeResult {
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
          score: item.first,
          reasoning: item.reasoning,
          ...(item.evidence === undefined ? {} : { evidence: item.evidence }),
        })),
      ),
    },
    request,
  );
}

export function compareIndependent(request: JudgeRequest, a: JudgeResult, b: JudgeResult): JudgeResult {
  if (a.unparsed || b.unparsed || !a.rubric || !b.rubric)
    return {
      raw: '',
      answer: { outcome: 'inconclusive', reasoning: 'an independent reply score is missing or invalid' },
      unparsed: true,
    };
  const second = new Map(b.rubric.items.map((item) => [item.name, item]));
  return parseJudgeValue(
    {
      items: a.rubric.items.map((item) => ({
        name: item.name,
        a: item.first,
        b: second.get(item.name)?.first,
        reasoning: `A: ${item.reasoning}\nB: ${second.get(item.name)?.reasoning ?? ''}`,
      })),
    },
    request,
  );
}

export function scoredWinner(result: JudgeResult): PairDecision {
  return !result.unparsed && (result.winner === 'A' || result.winner === 'B') ? result.winner : 'tie';
}
