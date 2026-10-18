import type { JudgeRequest } from '../contract';
import { isRecord } from '../http';
import { isPairLedgerRequest } from '../pair-ledger-contract';

export { isPairLedgerRequest } from '../pair-ledger-contract';

/** A transport capability, independent of the selected model or its earned judging category. */
export const JUDGE_DIALECTS = {
  openai: { id: 'openai-json-schema', output: 'json_schema', strict: true, reasoning: 'reasoning_effort' },
  google: {
    id: 'google-response-schema',
    output: 'responseSchema',
    nullable: true,
    reasoning: 'thinkingConfig.thinkingLevel',
  },
  anthropic: { id: 'scratchpad-json', output: 'scratchpad-then-last-json', reasoning: null },
  'claude-cli': { id: 'scratchpad-json', output: 'scratchpad-then-last-json', reasoning: null },
  http: { id: 'scratchpad-json', output: 'scratchpad-then-last-json', reasoning: 'request.reasoning' },
  jev: { id: 'system1-probability', output: 'yes-no-probability', reasoning: null },
  'openai-decisions': { id: 'system1-probability', output: 'yes-no-probability', reasoning: null },
} as const;

export type JudgeDialect = (typeof JUDGE_DIALECTS)[keyof typeof JUDGE_DIALECTS]['id'];

/** Select the real transport dialect; a caller cannot turn a text-only transport into a schema one. */
export function withJudgeDialect(
  request: JudgeRequest,
  dialect: JudgeDialect,
  reasoning?: string,
): JudgeRequest {
  if (!isPairLedgerRequest(request)) return request;
  const effort = request.reasoning ?? reasoning;
  return { ...request, dialect, ...(effort === undefined ? {} : { reasoning: effort }) };
}

/** Gemini's responseSchema represents nullable values using one type and nullable: true. */
export function googleResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(googleResponseSchema);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'additionalProperties' && key !== '$schema') result[key] = googleResponseSchema(nested);
  }
  if (Array.isArray(value.type)) {
    const nonNull = value.type.filter((type) => type !== 'null');
    if (nonNull.length !== 1) throw new RangeError('Google responseSchema needs one non-null type');
    result.type = nonNull[0];
    if (value.type.includes('null')) result.nullable = true;
  }
  if (Array.isArray(value.anyOf)) {
    const nonNull = value.anyOf.filter((part) => !isRecord(part) || part.type !== 'null');
    if (nonNull.length === 1 && nonNull.length < value.anyOf.length && isRecord(nonNull[0])) {
      delete result.anyOf;
      Object.assign(result, googleResponseSchema(nonNull[0]), { nullable: true });
    }
  }
  return result;
}
