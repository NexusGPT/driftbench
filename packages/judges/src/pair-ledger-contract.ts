import { z } from 'zod';
import type { RubricItem } from './assessment';
import { inconclusive, type JudgeRequest, type JudgeResult, repeatedObjectKey } from './contract';
import { requirementsFor } from './criterion-ledger';
import { candidateContainsQuote } from './evidence';

/** CLI flag accepted by examples/judge-benchmarks/src/llm-shim.mjs; pass a JSON schema string. */
export const SHIM_SCHEMA_FLAG = '--json-schema';

/** The model records evidence, never a winner, weight or verdict. */
export const PairLedger = z.strictObject({
  items: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        first: z.number().int().min(0).max(4).nullable(),
        second: z.number().int().min(0).max(4).nullable(),
        reasoning: z.string(),
        evidence: z.string().nullable().optional(),
      }),
    )
    .min(1),
});
export type PairLedger = z.infer<typeof PairLedger>;
export type LedgerParseStep = {
  readonly ruleId: string;
  readonly changed: boolean;
  readonly success: boolean;
};

export function isPairLedgerRequest(request: JudgeRequest): boolean {
  return (
    request.answerContract === 'ledger' &&
    request.assessment?.kind === 'pairwise' &&
    !request.assessment.tieFollowup
  );
}

/** Compilation is blind to candidate replies. Caller-owned names and definitions are authoritative. */
export function pairRequirements(request: JudgeRequest): readonly RubricItem[] {
  const items =
    request.assessment?.kind === 'pairwise' && request.assessment.items !== undefined
      ? request.assessment.items
      : requirementsFor(request).map((r) => ({ name: r.id, rubric: r.requirement }));
  validatePairRequirements(items);
  return items;
}

export function validatePairRequirements(items: readonly RubricItem[]): void {
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.some(
      (r) =>
        !r ||
        typeof r.name !== 'string' ||
        !r.name.trim() ||
        typeof r.rubric !== 'string' ||
        !r.rubric.trim() ||
        !Number.isFinite(r.weight ?? 1) ||
        (r.weight ?? 1) <= 0 ||
        (r.hard !== undefined && typeof r.hard !== 'boolean'),
    ) ||
    new Set(items.map((r) => r.name)).size !== items.length
  )
    throw new RangeError(
      'pair requirements need unique nonempty names, definitions and positive finite weights',
    );
}

/** OpenAI strict mode requires even optional evidence to be present (nullable on the wire). */
export function pairLedgerSchema(request: JudgeRequest): Record<string, unknown> {
  const names = pairRequirements(request).map((r) => r.name);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: names.length,
        maxItems: names.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'first', 'second', 'reasoning', 'evidence'],
          properties: {
            name: { type: 'string', enum: names },
            first: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            second: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
            reasoning: { type: 'string' },
            evidence: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
}

const invalid = (raw: string, why: string): JudgeResult => ({
  raw,
  unparsed: true,
  metadata: { graderError: true },
  answer: inconclusive(`invalid pair ledger: ${why}`),
});

export function parsePairLedgerValue(
  value: unknown,
  request: JudgeRequest,
  raw = JSON.stringify(value),
): JudgeResult {
  const expected = pairRequirements(request);
  const parsed = PairLedger.safeParse(value);
  if (!parsed.success) return invalid(raw, parsed.error.issues[0]?.message ?? 'invalid structure');
  const rows = new Map(parsed.data.items.map((r) => [r.name, r]));
  if (
    rows.size !== expected.length ||
    parsed.data.items.length !== expected.length ||
    expected.some((r) => !rows.has(r.name))
  )
    return invalid(raw, 'every requirement must appear exactly once with no extra rows');
  const pairLedger: PairLedger = {
    items: expected.map((def) => {
      const item = rows.get(def.name) as PairLedger['items'][number];
      const quote = item.evidence;
      const evidence =
        quote &&
        request.candidates &&
        (candidateContainsQuote(request.candidates.A, quote) ||
          candidateContainsQuote(request.candidates.B, quote))
          ? quote
          : null;
      return { ...item, evidence };
    }),
  };
  // This compatibility envelope carries no pair verdict. verdictFromLedger computes that after both orders.
  return { raw, pairLedger, answer: inconclusive('pair ledger recorded; compare both orders in code') };
}

/** Keep only the last top-level object, including an unfinished final object. Never rescue an earlier answer. */
function finalObject(raw: string): string {
  let depth = 0,
    start = -1;
  let quoted = false,
    escaped = false;
  let last = raw.trim();
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (depth === 0) {
      if (ch === '{') {
        start = i;
        depth = 1;
        quoted = false;
        escaped = false;
      }
    } else if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) last = raw.slice(start, i + 1);
  }
  return depth > 0 ? raw.slice(start).trim() : last;
}

/** Only invalid backslash escapes in JSON strings change. Scores, keys and valid escapes are untouched. */
function repairEscapes(raw: string): string {
  let out = '',
    quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (quoted && ch === '\\') {
      const next = raw[i + 1];
      if (
        next !== undefined &&
        (/["\\/bfnrt]/.test(next) || (next === 'u' && /^[0-9a-fA-F]{4}/.test(raw.slice(i + 2))))
      ) {
        out += ch + next;
        i++;
      } else out += '\\\\';
    } else {
      if (ch === '"') quoted = !quoted;
      out += ch;
    }
  }
  return out;
}

function closeContainers(raw: string): string {
  const stack: string[] = [];
  let quoted = false,
    escaped = false;
  for (const ch of raw) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if ((ch === '}' || ch === ']') && stack.pop() !== ch) return raw;
  }
  // Closing a truncated string would invent evidence or reasoning. Re-ask instead.
  return quoted || stack.length > 32 ? raw : raw + stack.reverse().join('');
}

/** Bounded, deterministic repair trace. Semantic failures never supply scores or missing requirements. */
export function parsePairLedgerText(raw: string, request: JudgeRequest): JudgeResult {
  pairRequirements(request);
  const steps: LedgerParseStep[] = [];
  const fenced = /^\s*```/m.test(raw);
  let text = finalObject(raw);
  let result = invalid(raw, 'no valid final JSON object');
  const attempt = (ruleId: string, candidate: string, forceFail = false): boolean => {
    const changed = candidate !== text;
    text = candidate;
    try {
      if (forceFail) throw new Error('fenced answer');
      if (repeatedObjectKey(text) !== undefined) throw new Error('duplicate object key');
      result = parsePairLedgerValue(JSON.parse(text), request, raw);
    } catch (cause) {
      result = invalid(raw, cause instanceof Error ? cause.message : String(cause));
    }
    steps.push({ ruleId, changed, success: !result.unparsed });
    return !result.unparsed;
  };
  const finish = (): JudgeResult => ({
    ...result,
    parseSteps: steps,
    ...(steps.some((s) => s.success && s.ruleId !== 'ledger.strict') ? { repaired: true } : {}),
  });
  if (attempt('ledger.strict', text, fenced)) return finish();
  if (attempt('ledger.invalid-escape', repairEscapes(text), fenced)) return finish();
  const stripped = raw.replace(/^\s*```(?:json)?\s*\r?\n?/gm, '').replace(/\s*```\s*$/gm, '');
  if (attempt('ledger.fence-strip', repairEscapes(finalObject(stripped)))) return finish();
  attempt('ledger.brace-close', closeContainers(text));
  return finish();
}
