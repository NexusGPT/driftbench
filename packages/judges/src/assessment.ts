import { z } from 'zod';
import type { JudgeClient } from './client';
import {
  extractObject,
  inconclusive,
  type JudgeRequest,
  type JudgeResult,
  parseAnswerText,
  parseAnswerValue,
  parseLegacyAnswerText,
  repairAnswerText,
} from './contract';
import { CriterionLedger, parseCriterionLedger } from './criterion-ledger';
import { FactLedgerAnswer, parseFactLedger } from './fact-audit';

/** A caller-supplied rubric item. Weights belong to the caller, never to the model. */
export type RubricItem = {
  readonly name: string;
  readonly rubric: string;
  readonly weight?: number;
  readonly hard?: boolean;
};
export type Assessment =
  | { readonly kind: 'pairwise' }
  | { readonly kind: 'fact-ledger' }
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
  winnerQuote: z.string().min(1).max(240).nullable(),
});
export type PairwiseAnswer = z.infer<typeof PairwiseAnswer>;

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
  const a = request.answerContract === 'legacy' ? undefined : request.assessment;
  if (a) validateAssessment(a);
  const schema =
    a?.kind === 'fact-ledger'
      ? FactLedgerAnswer
      : a?.kind === 'pairwise'
        ? PairwiseAnswer
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
  if (request.answerContract === 'legacy') return parseLegacyAnswerText(raw);
  const text = extractObject(raw);
  if (text === undefined) return invalid(raw, 'no final complete JSON object');
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
  if (request.answerContract === 'legacy') return parseAnswerValue(value, raw);
  const assessment = request.assessment;
  if (!assessment) return parseCriterionLedger(value, request, raw);
  validateAssessment(assessment);
  if (assessment.kind === 'fact-ledger') return parseFactLedger(value, request, raw);
  if (assessment.kind === 'pairwise') {
    const parsed = PairwiseAnswer.safeParse(value);
    if (!parsed.success) return invalid(raw, parsed.error.issues[0]?.message ?? 'invalid winner');
    const { winner, winnerQuote, ...answer } = parsed.data;
    if (winner === 'A' || winner === 'B') {
      const reply = request.candidates?.[winner];
      const fold = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
      if (winnerQuote === null || (reply !== undefined && !fold(reply).startsWith(fold(winnerQuote))))
        return invalid(raw, 'winnerQuote must quote the opening of the named winner');
    } else if (winnerQuote !== null) return invalid(raw, 'a tie or inconclusive has no winnerQuote');
    return {
      raw,
      winner,
      answer: { ...answer, outcome: winner === 'A' ? 'pass' : winner === 'B' ? 'fail' : 'inconclusive' },
    };
  }
  const parsed = (assessment.pairwise ? pairLedger : pointLedger).safeParse(value);
  if (!parsed.success) return invalid(raw, parsed.error.issues[0]?.message ?? 'invalid item score');
  const byName = new Map(parsed.data.items.map((item) => [item.name, item]));
  if (
    byName.size !== assessment.items.length ||
    parsed.data.items.length !== assessment.items.length ||
    assessment.items.some((item) => !byName.has(item.name))
  )
    return invalid(raw, 'every requested rubric item must appear exactly once, with no extra items');
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
    answer: { outcome, reasoning: items.map((item) => `${item.name}: ${item.reasoning}`).join('\n') },
    ...(assessment.pairwise ? { winner } : {}),
    rubric: { items, ...(first === undefined ? {} : { first }), ...(second === undefined ? {} : { second }) },
  };
}

function invalid(raw: string, why: string): JudgeResult {
  return { raw, answer: inconclusive(`answer breaks the assessment contract: ${why}`), unparsed: true };
}

/** One batched model call, one score per caller-supplied item, arithmetic in code. */
export async function judgeRubric(
  client: JudgeClient,
  request: JudgeRequest,
  items: readonly RubricItem[],
  options: { threshold?: number } = {},
): Promise<JudgeResult> {
  const assessment: Assessment = { kind: 'rubric', items, ...options };
  validateAssessment(assessment);
  return client.judge({ ...request, assessment });
}
