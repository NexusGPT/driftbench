import { AsyncLocalStorage } from 'node:async_hooks';
import {
  buildPrompt,
  createClaudeCliJudge,
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
export function makeRecordingClient(
  model: string,
  budget: SpendBudget,
  env: Record<string, string | undefined>,
  log: (row: SpendRow) => void,
  options: { haikuModel?: string; fetch?: typeof fetch } = {},
): JudgeClient {
  if (!['haiku', 'gpt-6-luna'].includes(model))
    throw new Error(`Recording model ${model} is not enabled; Gemini is skipped until billing is enabled`);
  for (const key of ['OPENAI_BASE_URL', 'OPENAI_JUDGE_MODEL', 'CLAUDE_JUDGE_MODEL']) {
    if (env[key]?.trim()) throw new Error(`${key} override is not allowed in a default bench recording`);
  }
  const actualModel = model === 'haiku' ? (options.haikuModel ?? 'claude-haiku-5-5') : model;
  const meter = new AsyncLocalStorage<{ cost?: number; model?: string; input?: number; output?: number }>();
  const base =
    model === 'haiku'
      ? createClaudeCliJudge({ id: model, model: actualModel, env, maxBudgetUsd: 0.02 })
      : createOpenAiJudge({
          id: model,
          model,
          env,
          maxRetries: 0,
          fetch: async (url, init) => {
            // Observe the response; do not rewrite the public client's request or answer.
            const response = await (options.fetch ?? fetch)(url, init);
            if (response.ok) {
              const payload = (await response.clone().json()) as { usage?: Usage; model?: string };
              const current = meter.getStore();
              if (!current) throw new Error('Missing cost scope');
              if (!payload.usage) throw new Error('OpenAI response has no usage');
              current.cost = openAiCost(payload.usage);
              current.model = payload.model;
              current.input = payload.usage.prompt_tokens;
              current.output = payload.usage.completion_tokens;
            }
            return response;
          },
        });
  return {
    ...base,
    async judge(request) {
      const prompt = buildPrompt(request);
      // One UTF-8 byte per token is an intentionally loose upper bound, including protocol/schema overhead.
      const reservation =
        model === 'haiku'
          ? 0.02
          : ((Buffer.byteLength(prompt.system + prompt.user) + 8192) * LUNA_RATES.input +
              1024 * LUNA_RATES.output) /
            1_000_000;
      const token = budget.reserve(reservation);
      const data: { cost?: number; model?: string; input?: number; output?: number } = {};
      let status: 'ok' | 'error' = 'error';
      try {
        return await meter.run(data, async () => {
          const result = await base.judge(request);
          data.cost ??= result.costUsd;
          if (data.cost === undefined) throw new Error('Recorder refuses an unmetered answer');
          status = 'ok';
          return { ...result, costUsd: data.cost };
        });
      } finally {
        // Even an overrun must reach the append-only spend ledger before it stops the run.
        try {
          budget.settle(token, data.cost);
        } finally {
          log({
            at: new Date().toISOString(),
            model,
            resolvedModel: data.model ?? actualModel,
            costUsd: data.cost ?? 0,
            chargedUsd: data.cost ?? reservation,
            accounting:
              data.cost === undefined ? 'reserved-on-error' : model === 'haiku' ? 'provider' : 'tokens',
            status,
            ...(data.input === undefined ? {} : { inputTokens: data.input, outputTokens: data.output }),
          });
        }
      }
    },
  };
}
