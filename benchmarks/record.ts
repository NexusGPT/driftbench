import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createClaudeCliJudge,
  createGoogleJudge,
  createOpenAiJudge,
  type JudgeClient,
} from '@agent-nexus/driftbench-judges';

export type SpendRow = {
  at: string;
  model: string;
  resolvedModel: string;
  costUsd: number;
  chargedUsd: number;
  accounting: 'provider' | 'tokens' | 'reserved-on-error';
  status: 'ok' | 'error';
  inputTokens?: number;
  outputTokens?: number;
};
/** In-flight calls reserve their upper bound before any network or process call starts. */
export class SpendBudget {
  spent = 0;
  private reserved = new Map<symbol, number>();
  constructor(readonly cap: number) {
    if (!(Number.isFinite(cap) && cap > 0)) throw new Error('spend cap must be a finite positive USD amount');
  }
  reserve(amount: number): symbol {
    if (!(Number.isFinite(amount) && amount > 0)) throw new Error('Invalid reservation');
    const held = [...this.reserved.values()].reduce((a, b) => a + b, 0);
    if (this.spent + held + amount > this.cap + 1e-12)
      throw new Error(
        `spend cap reached: $${this.spent.toFixed(6)} spent, $${held.toFixed(6)} in flight, $${amount.toFixed(6)} needed`,
      );
    const token = Symbol('call');
    this.reserved.set(token, amount);
    return token;
  }
  settle(token: symbol, actual: number | undefined): number {
    const amount = this.reserved.get(token);
    if (amount === undefined) throw new Error('Unknown reservation');
    const charged = actual === undefined ? amount : actual;
    if (!(Number.isFinite(charged) && charged >= 0)) throw new Error('Invalid metered cost');
    this.reserved.delete(token);
    this.spent += charged;
    if (charged > amount + 1e-12 || this.spent > this.cap + 1e-12)
      throw new Error(`Provider cost exceeded its reservation or spend cap: $${charged.toFixed(6)}`);
    return charged;
  }
}
// Standard direct API rates, verified 2026-10-13. Cached input is discounted.
// https://developers.openai.com/api/docs/models/gpt-6-luna
export const LUNA_RATES = { input: 0.1, cached: 0.01, output: 0.5 };
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
export function openAiCost(usage: Usage): number {
  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  if (
    input === undefined ||
    output === undefined ||
    ![input, output, cached].every((n) => Number.isInteger(n) && n >= 0) ||
    cached > input
  )
    throw new Error('Missing or invalid OpenAI token usage');
  if (input > 272_000) throw new Error('Long-context pricing is outside this bench recorder');
  return (
    ((input - cached) * LUNA_RATES.input + cached * LUNA_RATES.cached + output * LUNA_RATES.output) /
    1_000_000
  );
}
// Introductory direct API text rates through 2026-12-31, including thinking output.
// https://ai.google.dev/gemini-api/docs/pricing
export const GEMINI_RATES = { input: 0.75, cached: 0.075, output: 3.75 };
interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}
export function geminiCost(usage: GeminiUsage): number {
  const input = usage.promptTokenCount;
  const output = usage.candidatesTokenCount ?? 0;
  const thinking = usage.thoughtsTokenCount ?? 0;
  const cached = usage.cachedContentTokenCount ?? 0;
  if (
    input === undefined ||
    ![input, output, thinking, cached].every((n) => Number.isInteger(n) && n >= 0) ||
    cached > input
  )
    throw new Error('Missing or invalid Gemini token usage');
  return (
    ((input - cached) * GEMINI_RATES.input +
      cached * GEMINI_RATES.cached +
      (output + thinking) * GEMINI_RATES.output) /
    1_000_000
  );
}
export function makeRecordingClient(
  model: string,
  budget: SpendBudget,
  env: Record<string, string | undefined>,
  log: (row: SpendRow) => void,
  options: { haikuModel?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): JudgeClient {
  if (!['haiku', 'gpt-6-luna', 'gemini-3.8-flash'].includes(model))
    throw new Error(`Recording model ${model} is not enabled`);
  for (const key of [
    'OPENAI_BASE_URL',
    'OPENAI_JUDGE_MODEL',
    'CLAUDE_JUDGE_MODEL',
    'GOOGLE_BASE_URL',
    'GOOGLE_JUDGE_MODEL',
  ]) {
    if (env[key]?.trim()) throw new Error(`${key} override is not allowed in a default bench recording`);
  }
  const actualModel = model === 'haiku' ? (options.haikuModel ?? 'claude-haiku-5-5') : model;
  type Meter = {
    cost?: number;
    model?: string;
    input?: number;
    output?: number;
    charged: number;
    unmetered: boolean;
    attempted?: boolean;
    failure?: unknown;
    pending?: { token: symbol; amount: number; rejected?: boolean };
  };
  const meter = new AsyncLocalStorage<Meter>();
  const rates = model === 'gemini-3.8-flash' ? GEMINI_RATES : LUNA_RATES;
  const settle = (current: Meter, actual: number | undefined) => {
    const pending = current.pending;
    if (!pending) return;
    current.pending = undefined;
    try {
      budget.settle(pending.token, actual);
    } catch (cause) {
      current.failure = cause;
      throw cause;
    } finally {
      current.charged += actual ?? pending.amount;
      current.unmetered ||= actual === undefined;
    }
  };
  const observedFetch = async (url: string, init: RequestInit) => {
    const current = meter.getStore();
    if (!current) throw new Error('Missing cost scope');
    try {
      if (typeof init.body !== 'string') throw new Error('Recorder requires a JSON request body');
      const body = JSON.parse(init.body) as { max_completion_tokens?: number };
      // Reserve each wire request, including a recovery with a larger output allowance.
      // Gemini thinking may overshoot the requested cap, so reserve its full model ceiling.
      // https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
      const outputLimit = model === 'gemini-3.8-flash' ? 65_536 : body.max_completion_tokens;
      if (outputLimit === undefined || !Number.isSafeInteger(outputLimit) || outputLimit <= 0)
        throw new Error('Recorder requires a bounded output allowance');
      const amount =
        ((Buffer.byteLength(init.body) + 8192) * rates.input + outputLimit * rates.output) / 1_000_000;
      // Rejected HTTP attempts can reuse their held allowance. A terminal error retains it.
      if (current.pending && (!current.pending.rejected || current.pending.amount < amount))
        settle(current, current.pending.rejected ? 0 : undefined);
      current.pending ??= { token: budget.reserve(amount), amount };
      current.pending.rejected = false;
    } catch (cause) {
      current.failure = cause;
      throw cause;
    }
    current.attempted = true;
    // Observe the response; do not rewrite the public client's request or answer.
    const response = await (options.fetch ?? fetch)(url, init);
    if (response.ok) {
      const payload = (await response.clone().json()) as {
        usage?: Usage;
        model?: string;
        usageMetadata?: GeminiUsage;
        modelVersion?: string;
      };
      let cost: number;
      if (model === 'gemini-3.8-flash') {
        if (!payload.usageMetadata) throw new Error('Gemini response has no usage');
        cost = geminiCost(payload.usageMetadata);
        current.model = payload.modelVersion;
        current.input = (current.input ?? 0) + (payload.usageMetadata.promptTokenCount ?? 0);
        current.output =
          (current.output ?? 0) +
          (payload.usageMetadata.candidatesTokenCount ?? 0) +
          (payload.usageMetadata.thoughtsTokenCount ?? 0);
      } else {
        if (!payload.usage) throw new Error('OpenAI response has no usage');
        cost = openAiCost(payload.usage);
        current.model = payload.model;
        current.input = (current.input ?? 0) + (payload.usage.prompt_tokens ?? 0);
        current.output = (current.output ?? 0) + (payload.usage.completion_tokens ?? 0);
      }
      current.cost = (current.cost ?? 0) + cost;
      settle(current, cost);
    } else if (current.pending) {
      current.pending.rejected = true;
    }
    return response;
  };
  const base =
    model === 'haiku'
      ? createClaudeCliJudge({ id: model, model: actualModel, env, maxBudgetUsd: 0.02 })
      : model === 'gemini-3.8-flash'
        ? createGoogleJudge({
            id: model,
            model,
            env,
            reasoning: 'medium',
            timeoutMs: 300_000,
            maxRetries: 0,
            fetch: observedFetch,
          })
        : createOpenAiJudge({
            id: model,
            model,
            env,
            reasoning: 'medium',
            maxRetries: 0,
            fetch: observedFetch,
          });
  return {
    ...base,
    async judge(request) {
      if (model === 'gemini-3.8-flash' && Date.now() >= Date.parse('2027-01-01T00:00:00Z'))
        throw new Error('Gemini introductory pricing expired; update the metered rates before recording');
      const data: Meter = { charged: 0, unmetered: false };
      if (model === 'haiku') {
        data.pending = { token: budget.reserve(0.02), amount: 0.02 };
        data.attempted = true;
      }
      let status: 'ok' | 'error' = 'error';
      try {
        return await meter.run(data, async () => {
          const sleep =
            options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
          let result: Awaited<ReturnType<JudgeClient['judge']>>;
          for (let attempt = 0; ; attempt++) {
            try {
              result = await base.judge(request);
              break;
            } catch (cause) {
              if (data.failure) throw data.failure;
              if (
                model !== 'gemini-3.8-flash' ||
                !(cause instanceof Error) ||
                !('status' in cause) ||
                cause.status !== 429 ||
                attempt >= 3
              )
                throw cause;
              // Shared Gemini quota: retry only explicit rate limits, with a fresh request timeout.
              const retryAfter =
                'retryAfterMs' in cause &&
                typeof cause.retryAfterMs === 'number' &&
                Number.isFinite(cause.retryAfterMs)
                  ? cause.retryAfterMs
                  : 0;
              await sleep(Math.max(60_000 * 2 ** attempt, retryAfter));
            }
          }
          data.cost ??= result.costUsd;
          if (data.cost === undefined) throw new Error('Recorder refuses an unmetered answer');
          status = 'ok';
          return { ...result, costUsd: data.cost };
        });
      } finally {
        // Even an overrun must reach the append-only spend ledger before it stops the run.
        try {
          settle(data, model === 'haiku' ? data.cost : undefined);
        } finally {
          if (data.attempted)
            log({
              at: new Date().toISOString(),
              model,
              resolvedModel: data.model ?? actualModel,
              costUsd: data.cost ?? 0,
              chargedUsd: data.charged,
              accounting: data.unmetered ? 'reserved-on-error' : model === 'haiku' ? 'provider' : 'tokens',
              status,
              ...(data.input === undefined ? {} : { inputTokens: data.input, outputTokens: data.output }),
            });
        }
      }
    },
  };
}
