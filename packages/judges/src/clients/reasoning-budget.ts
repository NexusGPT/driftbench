import { type HttpOptions, isRecord, JudgeError, postJson } from '../http';
import { type TokenUsage, usageFromResponse } from './usage';

/** Headroom, not a hard partition on providers that expose only a combined limit. */
export type TokenBudget = {
  readonly answerTokens: number;
  readonly reasoningTokens: number;
  /** Gemini budget-capable models only. Replaces thinkingLevel with thinkingBudget. */
  readonly googleThinkingBudget?: boolean;
};
export type ReasoningRecovery = {
  readonly kind: 'reasoning-budget-exhausted';
  readonly attempts: readonly { readonly raw: string; readonly usage: TokenUsage }[];
};
export class ReasoningBudgetError extends JudgeError {
  constructor(readonly recovery: ReasoningRecovery) {
    super('reasoning-budget-exhausted', 'reasoning-budget-exhausted: no answer after one recovery');
  }
}
export function validateTokenBudget(budget: TokenBudget | undefined, provider: string): void {
  if (!budget) return;
  if (provider !== 'openai' && provider !== 'google')
    throw new JudgeError('config', 'tokenBudget requires OpenAI or Google');
  if (
    !Number.isSafeInteger(budget.answerTokens) ||
    budget.answerTokens <= 0 ||
    !Number.isSafeInteger(budget.reasoningTokens) ||
    budget.reasoningTokens < 0 ||
    !Number.isSafeInteger(budget.answerTokens + budget.reasoningTokens)
  )
    throw new RangeError('tokenBudget requires positive answerTokens and nonnegative reasoningTokens');
  if (budget.googleThinkingBudget && provider !== 'google')
    throw new JudgeError('config', 'googleThinkingBudget requires Google');
}
export function budgetBody(
  provider: string,
  body: Record<string, unknown>,
  budget?: TokenBudget,
): Record<string, unknown> {
  if (!budget) return body;
  const tokens = budget.answerTokens + budget.reasoningTokens;
  if (provider === 'openai') return { ...body, max_completion_tokens: tokens };
  const config = isRecord(body.generationConfig) ? body.generationConfig : {};
  return {
    ...body,
    generationConfig: {
      ...config,
      maxOutputTokens: tokens,
      ...(budget.googleThinkingBudget ? { thinkingConfig: { thinkingBudget: budget.reasoningTokens } } : {}),
    },
  };
}
function emptyLength(provider: string, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const rows = provider === 'openai' ? payload.choices : payload.candidates;
  const row = Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : {};
  const content = provider === 'openai' ? row.message : row.content;
  const value = isRecord(content) ? (provider === 'openai' ? content.content : content.parts) : undefined;
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .filter((p) => isRecord(p) && p.thought !== true && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
        : '';
  return (
    !text.trim() &&
    (provider === 'openai' ? row.finish_reason === 'length' : row.finishReason === 'MAX_TOKENS')
  );
}
export function recoveryBody(provider: string, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === 'openai')
    return {
      ...body,
      max_completion_tokens: Number(body.max_completion_tokens) * 2,
      ...(body.reasoning_effort === undefined ? {} : { reasoning_effort: 'low' }),
    };
  const config = isRecord(body.generationConfig) ? body.generationConfig : {};
  const thinking = isRecord(config.thinkingConfig) ? config.thinkingConfig : {};
  return {
    ...body,
    generationConfig: {
      ...config,
      maxOutputTokens: Number(config.maxOutputTokens) * 2,
      ...(thinking.thinkingLevel === undefined
        ? {}
        : { thinkingConfig: { ...thinking, thinkingLevel: 'low' } }),
    },
  };
}
export async function postReasoningJson(
  provider: 'openai' | 'google',
  url: string,
  headers: Record<string, string>,
  original: Record<string, unknown>,
  options: HttpOptions & { tokenBudget?: TokenBudget },
) {
  const body = budgetBody(provider, original, options.tokenBudget);
  const first = await postJson(url, headers, body, options);
  if (!emptyLength(provider, first)) return { payload: first };
  const attempts: { raw: string; usage: TokenUsage }[] = [];
  const receipt = (payload: unknown) => {
    const usage = usageFromResponse(provider, payload);
    const thoughts =
      provider === 'google' && isRecord(payload) && isRecord(payload.usageMetadata)
        ? payload.usageMetadata.thoughtsTokenCount
        : undefined;
    attempts.push({
      raw: JSON.stringify(payload),
      usage: {
        ...usage,
        ...(typeof thoughts === 'number' ? { output: (usage.output ?? 0) + thoughts } : {}),
      },
    });
  };
  receipt(first);
  const second = await postJson(url, headers, recoveryBody(provider, body), options);
  receipt(second);
  const recovery: ReasoningRecovery = { kind: 'reasoning-budget-exhausted', attempts };
  if (emptyLength(provider, second)) throw new ReasoningBudgetError(recovery);
  return { payload: second, recovery };
}
