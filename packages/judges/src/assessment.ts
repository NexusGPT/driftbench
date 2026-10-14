import { z } from 'zod';
import { AnswerAudit, parseAnswerAudit, validateAnswerAuditRequest } from './answer-audit';
import type { JudgeClient } from './client';
import {
  ConformanceAudit,
  parseConformanceText,
  parseConformanceValue,
  validateConformanceRequest,
} from './conformance';
import {
  extractObject,
  inconclusive,
  type JudgeRequest,
  type JudgeResult,
  repairAnswerText,
  repeatedObjectKey,
} from './contract';
import { CriterionLedger, parseCriterionLedger, requirementsFor } from './criterion-ledger';
import { candidateContainsQuote, quoteContinuations, stripReplyLabel } from './evidence';
import {
  FactLedgerAnswer,
  PointwiseFactLedgerAnswer,
  parseFactLedger,
  parsePointwiseFactLedger,
  validatePointwiseFactRequest,
} from './fact-audit';
import {
  parseAnswerText as parseLegacyAnswerText,
  parseAnswerValue as parseLegacyAnswerValue,
} from './legacy-contract';
import {
  isPairLedgerRequest,
  pairLedgerSchema,
  parsePairLedgerText,
  parsePairLedgerValue,
} from './pair-ledger-contract';
import {
  parseResponseRelevance,
  ResponseRelevanceAnswer,
  validateResponseRelevanceRequest,
} from './response-relevance';

/** The caller owns item names and weights. Names identify requirements, never output positions. */
export type RubricItem = {
  readonly name: string;
  readonly rubric: string;
  readonly weight?: number;
  readonly hard?: boolean;
};
export type Assessment =
  | {
      readonly kind: 'pairwise';
      readonly items?: readonly RubricItem[];
      /** Internal contract of the opt-in final ledger tie follow-up. */
      readonly tieFollowup?: 'direct' | 'reasoning';
    }
  | {
      readonly kind: 'fact-ledger';
      /** Pointwise only: reject reference/reply text that is not a source quote. Default semantic. */
      readonly grounding?: 'strict';
    }
  | { readonly kind: 'response-relevance' }
  | { readonly kind: 'conformance'; readonly reference: string }
  /** Role-separated audit of a submitted answer against the criterion and an optional reference. */
  | { readonly kind: 'answer-audit' }
  | {
      readonly kind: 'rubric';
      readonly items: readonly RubricItem[];
      readonly pairwise?: boolean;
      /** Pointwise passing fraction. Default 1: every requirement fully met. */
      readonly threshold?: number;
    };

export const PairwiseAnswer = z.strictObject({
  winner: z.enum(['A', 'B', 'tie', 'inconclusive']),
  reasoning: z.string(),
  evidence: z.string().optional(),
  winnerQuote: z.string().trim().min(1).nullable(),
});
export type PairwiseAnswer = z.infer<typeof PairwiseAnswer>;

const PairLedgerFollowupAnswer = z.strictObject({ winner: z.enum(['A', 'B']) });

const score = z.number().int().min(0).max(4).nullable();
const pointItem = z.strictObject({
  name: z.string(),
  score,
  reasoning: z.string(),
  evidence: z.string().optional(),
});
const pairItem = z.strictObject({
  name: z.string(),
  a: score,
  b: score,
  reasoning: z.string(),
  evidence: z.string().optional(),
});
const pointLedger = z.strictObject({ items: z.array(pointItem).min(1) });
const pairLedger = z.strictObject({ items: z.array(pairItem).min(1) });

export type RubricScore = {
  readonly name: string;
  readonly first: number | null;
  readonly second?: number | null;
  readonly reasoning: string;
  readonly evidence?: string;
};
export type RubricScores = {
  readonly items: readonly RubricScore[];
  /** Weighted fulfillment from 0 to 1. Absent when any required score is unknown. */
  readonly first?: number;
  readonly second?: number;
};

/** Reject a malformed rubric before spending on a model. */
export function validateAssessment(assessment: Assessment): void {
  if (assessment.kind !== 'rubric') return;
  const names = new Set<string>();
  if (assessment.items.length === 0) throw new RangeError('a rubric needs at least one item');
  for (const item of assessment.items) {
    if (!item.name.trim() || !item.rubric.trim() || names.has(item.name))
      throw new RangeError('rubric items need unique nonempty names and nonempty requirements');
    if (!Number.isFinite(item.weight ?? 1) || (item.weight ?? 1) <= 0)
      throw new RangeError('a rubric weight must be finite and above zero');
    names.add(item.name);
  }
  if (
    !Number.isFinite(assessment.threshold ?? 1) ||
    (assessment.threshold ?? 1) < 0 ||
    (assessment.threshold ?? 1) > 1
  )
    throw new RangeError('a rubric threshold must be from 0 to 1');
}

/** The provider schema matches the exact answer contract of this request. */
export function responseSchema(request: JudgeRequest): Record<string, unknown> & { properties?: unknown } {
  if (isPairLedgerRequest(request)) return pairLedgerSchema(request);
  if (request.assessment?.kind === 'response-relevance') validateResponseRelevanceRequest(request);
  if (request.assessment?.kind === 'conformance') validateConformanceRequest(request);
  if (request.assessment?.kind === 'answer-audit') validateAnswerAuditRequest(request);
  const a = request.answerContract === 'legacy' ? undefined : request.assessment;
  if (a) validateAssessment(a);
  if (a?.kind === 'fact-ledger' && !request.candidates) validatePointwiseFactRequest(request);
  const schema =
    a?.kind === 'response-relevance'
      ? ResponseRelevanceAnswer
      : a?.kind === 'conformance'
        ? ConformanceAudit
        : a?.kind === 'answer-audit'
          ? AnswerAudit
          : a?.kind === 'fact-ledger'
            ? request.candidates
              ? FactLedgerAnswer
              : PointwiseFactLedgerAnswer
            : a?.kind === 'pairwise'
              ? a.tieFollowup
                ? PairLedgerFollowupAnswer
                : PairwiseAnswer
              : a?.kind === 'rubric'
                ? a.pairwise
                  ? pairLedger
                  : pointLedger
                : request.answerContract === 'legacy'
                  ? undefined
                  : CriterionLedger;
  if (!schema)
    return {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
        score: { type: 'number', minimum: 0, maximum: 1 },
        reasoning: { type: 'string' },
        evidence: { type: 'string' },
      },
      required: ['outcome', 'reasoning'],
      additionalProperties: false,
    };
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema);
  return json;
}

/** Parse only the final complete object. No binary fallback can reverse an explicit winner. */
export function parseJudgeText(raw: string, request: JudgeRequest): JudgeResult {
  if (request.assessment?.kind === 'response-relevance') {
    const text = extractObject(raw);
    if (text === undefined) return invalid(raw, 'no final complete JSON object');
    const duplicate = repeatedObjectKey(text);
    if (duplicate !== undefined) return invalid(raw, `repeated key ${duplicate}`);
    try {
      return parseJudgeValue(JSON.parse(text), request, raw);
    } catch {
      return invalid(raw, 'invalid JSON');
    }
  }
  if (request.assessment?.kind === 'conformance') {
    validateConformanceRequest(request);
    return parseConformanceText(raw);
  }
  if (request.answerContract === 'legacy') return parseLegacyAnswerText(raw);
  if (isPairLedgerRequest(request)) return parsePairLedgerText(raw, request);
  const callerError = requirementsError(request);
  if (callerError) return invalid(raw, callerError);
  const text = extractObject(raw);
  if (text === undefined) return invalid(raw, 'no final complete JSON object');
  const duplicate = repeatedObjectKey(repairAnswerText(text));
  if (duplicate !== undefined) return invalid(raw, `repeated key ${duplicate}`);
  try {
    return parseJudgeValue(JSON.parse(text), request, raw);
  } catch {
    try {
      const repaired = parseJudgeValue(JSON.parse(repairAnswerText(text)), request, raw);
      if (!repaired.unparsed) return { ...repaired, repaired: true };
    } catch {
      // A syntax repair never supplies a winner or a missing requirement.
    }
    return invalid(raw, 'invalid JSON');
  }
}

export function parseJudgeValue(
  value: unknown,
  request: JudgeRequest,
  raw = JSON.stringify(value),
): JudgeResult {
  if (request.assessment?.kind === 'response-relevance') {
    const duplicate = repeatedObjectKey(raw);
    if (duplicate !== undefined) return invalid(raw, `repeated key ${duplicate}`);
    return parseResponseRelevance(value, request, raw);
  }
  if (request.assessment?.kind === 'conformance') {
    validateConformanceRequest(request);
    return parseConformanceValue(value, raw);
  }
  if (request.answerContract === 'legacy') return parseLegacyAnswerValue(value, raw);
  if (isPairLedgerRequest(request)) {
    const result = parsePairLedgerValue(value, request, raw);
    return repeatedObjectKey(raw) === undefined
      ? result
      : {
          raw,
          unparsed: true,
          metadata: { graderError: true },
          answer: inconclusive('duplicate pair ledger key'),
        };
  }
  const callerError = requirementsError(request);
  if (callerError) return invalid(raw, callerError);
  const duplicate = repeatedObjectKey(repairAnswerText(raw));
  if (duplicate !== undefined) return invalid(raw, `repeated key ${duplicate}`);
  const assessment = request.assessment;
  if (!assessment) return parseCriterionLedger(value, request, raw);
  validateAssessment(assessment);
  if (assessment.kind === 'answer-audit') return parseAnswerAudit(value, request, raw);
  if (assessment.kind === 'fact-ledger')
    return request.candidates
      ? parseFactLedger(value, request, raw)
      : parsePointwiseFactLedger(value, request, raw);
  if (assessment.kind === 'pairwise') {
    if (assessment.tieFollowup) {
      const parsed = PairLedgerFollowupAnswer.safeParse(value);
      if (!parsed.success) return invalid(raw, 'tie follow-up requires exactly one winner, A or B');
      return {
        raw,
        winner: parsed.data.winner,
        answer: {
          outcome: parsed.data.winner === 'A' ? 'pass' : 'fail',
          reasoning: 'forced-choice ledger tie follow-up',
        },
      };
    }
    const parsed = PairwiseAnswer.safeParse(value);
    if (!parsed.success) return invalid(raw, parsed.error.issues[0]?.message ?? 'invalid winner');
    const { winner, winnerQuote, ...answer } = parsed.data;
    if (winner === 'A' || winner === 'B') {
      const body = winnerQuote === null ? undefined : stripReplyLabel(winnerQuote, winner);
      if (body === undefined) return invalid(raw, 'winnerQuote label must agree with the named winner');
      const matching = (quote: string) =>
        (['A', 'B'] as const).filter((side) => {
          const text = request.candidates?.[side];
          return text !== undefined && candidateContainsQuote(text, quote);
        });
      let matches = !request.candidates ? [] : matching(body);
      if (matches.length === 2 && answer.evidence) {
        // Extend only with text the model actually supplied. Never invent the next words from the
        // candidate selected by its label. The whole continuation must occur after the shared quote.
        for (const following of evidencePassages(answer.evidence, winner)) {
          const passage = stripReplyLabel(following, winner);
          if (passage === undefined) continue;
          for (const continuation of [passage, ...quoteContinuations(passage, body)]) {
            const extended = matching(`${body} ... ${continuation}`);
            if (extended.length === 1 && extended[0] === winner) {
              matches = extended;
              break;
            }
          }
          if (matches.length === 1) break;
        }
      }
      if (matches.length === 2) return invalid(raw, 'your quote matches both replies');
      if (matches.length !== 1 || matches[0] !== winner)
        return invalid(raw, 'winnerQuote must quote a passage present only in the named winner');
    } else if (winnerQuote !== null) return invalid(raw, 'a tie or inconclusive has no winnerQuote');
    return {
      raw,
      winner,
      answer: { ...answer, outcome: winner === 'A' ? 'pass' : winner === 'B' ? 'fail' : 'inconclusive' },
    };
  }
  const names = new Set(assessment.items.map((item) => item.name));
  const ignoredRequirementIds: string[] = [];
  let known = value;
  if (value !== null && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) {
    const items = value.items.filter((row: unknown) => {
      if (
        row !== null &&
        typeof row === 'object' &&
        'name' in row &&
        typeof row.name === 'string' &&
        !names.has(row.name)
      ) {
        ignoredRequirementIds.push(row.name);
        return false;
      }
      return true;
    });
    known = { ...value, items };
  }
  const diagnostics = ignoredRequirementIds.length ? { ignoredRequirementIds } : {};
  const invalidRubric = (why: string): JudgeResult => ({ ...invalid(raw, why), ...diagnostics });
  const parsed = (assessment.pairwise ? pairLedger : pointLedger).safeParse(known);
  if (!parsed.success) return invalidRubric(parsed.error.issues[0]?.message ?? 'invalid item score');
  const byName = new Map(parsed.data.items.map((item) => [item.name, item]));
  if (
    byName.size !== assessment.items.length ||
    parsed.data.items.length !== assessment.items.length ||
    assessment.items.some((item) => !byName.has(item.name))
  )
    return invalidRubric('every requested rubric item must appear exactly once');
  const items: RubricScore[] = assessment.items.map((def) => {
    const item = byName.get(def.name) as z.infer<typeof pointItem> | z.infer<typeof pairItem>;
    const { name, reasoning, evidence } = item;
    return {
      name,
      reasoning,
      ...(evidence === undefined ? {} : { evidence }),
      first: 'score' in item ? item.score : item.a,
      ...('b' in item ? { second: item.b } : {}),
    };
  });
  const aggregate = (side: 'first' | 'second'): number | undefined => {
    if (items.some((item) => item[side] === null || item[side] === undefined)) return undefined;
    const total = assessment.items.reduce((sum, def) => sum + (def.weight ?? 1), 0);
    return (
      items.reduce((sum, item, i) => sum + (item[side] as number) * (assessment.items[i]?.weight ?? 1), 0) /
      (4 * total)
    );
  };
  const first = aggregate('first');
  const second = assessment.pairwise ? aggregate('second') : undefined;
  const hardFirst = assessment.items.every((def, i) => !def.hard || items[i]?.first === 4);
  const hardSecond = assessment.items.every((def, i) => !def.hard || items[i]?.second === 4);
  const winner =
    first === undefined || second === undefined
      ? 'inconclusive'
      : hardFirst !== hardSecond
        ? hardFirst
          ? 'A'
          : 'B'
        : first > second
          ? 'A'
          : second > first
            ? 'B'
            : 'tie';
  const outcome = assessment.pairwise
    ? winner === 'A'
      ? 'pass'
      : winner === 'B'
        ? 'fail'
        : 'inconclusive'
    : first === undefined
      ? 'inconclusive'
      : hardFirst && first >= (assessment.threshold ?? 1)
        ? 'pass'
        : 'fail';
  return {
    raw,
    ...diagnostics,
    answer: { outcome, reasoning: items.map((item) => `${item.name}: ${item.reasoning}`).join('\n') },
    ...(assessment.pairwise ? { winner } : {}),
    rubric: { items, ...(first === undefined ? {} : { first }), ...(second === undefined ? {} : { second }) },
  };
}

function evidencePassages(evidence: string, winner: 'A' | 'B'): string[] {
  const markers = [...evidence.matchAll(/\bReply\s+([AB])\s*:\s*/g)];
  const blocks =
    markers.length === 0
      ? [evidence]
      : markers.flatMap((marker, i) =>
          marker[1] === winner
            ? [
                evidence.slice(
                  (marker.index ?? 0) + marker[0].length,
                  markers[i + 1]?.index ?? evidence.length,
                ),
              ]
            : [],
        );
  return blocks.flatMap((block) => {
    const quoted = [...block.matchAll(/"((?:\\.|[^"\\])*)"|“([^”]*)”/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((text) => text.trim());
    return quoted.length ? quoted : [block.trim()].filter(Boolean);
  });
}

function invalid(raw: string, why: string): JudgeResult {
  return { raw, answer: inconclusive(`answer breaks the assessment contract: ${why}`), unparsed: true };
}

function requirementsError(request: JudgeRequest): string | undefined {
  if (request.assessment) return undefined;
  try {
    requirementsFor(request);
    return undefined;
  } catch (cause) {
    return `invalid caller requirements: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/** One batched score ledger, with one large-budget re-ask if it breaks the caller's contract. */
export async function judgeRubric(
  client: JudgeClient,
  request: JudgeRequest,
  items: readonly RubricItem[],
  options: { threshold?: number } = {},
): Promise<JudgeResult> {
  const assessment: Assessment = { kind: 'rubric', items, ...options };
  validateAssessment(assessment);
  const scoped = { ...request, assessment };
  const first = await client.judge(scoped);
  if (request.answerContract === 'legacy') return first;
  const normalize = (result: JudgeResult): JudgeResult => {
    if (result.unparsed) return { ...result, answer: inconclusive(result.answer.reasoning) };
    if (!result.rubric) return { ...result, ...invalid(result.raw, 'client returned no rubric item ledger') };
    return result;
  };
  const result = normalize(first);
  if (!result.unparsed) return result;
  const retry = normalize(await client.judge({ ...scoped, budget: 'large' }));
  return {
    ...retry,
    ...(first.costUsd === undefined && retry.costUsd === undefined
      ? {}
      : { costUsd: (first.costUsd ?? 0) + (retry.costUsd ?? 0) }),
    // An unknown part makes the sum unknown: it is never reported as the known part alone.
    ...(first.costIncomplete || retry.costIncomplete
      ? { costUsd: undefined, costIncomplete: true as const }
      : {}),
  };
}
