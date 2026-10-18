import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  buildPrompt,
  createGoogleJudge,
  createOpenAiJudge,
  type JudgeClient,
  outputRoom,
  parseJudgeText,
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
// Standard Flash-Lite text rates, verified 2026-10-13 at the pricing URL above.
export const GEMINI_LITE_RATES = { input: 0.3, cached: 0.03, output: 2.5 };
interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}
export function geminiCost(usage: GeminiUsage, rates = GEMINI_RATES): number {
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
    ((input - cached) * rates.input + cached * rates.cached + (output + thinking) * rates.output) / 1_000_000
  );
}
// Direct API text rates: https://platform.claude.com/docs/en/models/haiku-5-5/overview
// Input counters are disjoint; long context (>100k total input) multiplies all rates by five.
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}
function anthropicCost(usage: AnthropicUsage): number {
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const read = usage.cache_read_input_tokens ?? 0;
  const creation = usage.cache_creation_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMinutes = usage.cache_creation?.ephemeral_5m_input_tokens ?? creation - oneHour;
  if (
    input === undefined ||
    output === undefined ||
    ![input, output, read, creation, oneHour, fiveMinutes].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    oneHour + fiveMinutes !== creation
  )
    throw new Error('Missing or invalid Anthropic token usage');
  const scale = input + read + creation > 100_000 ? 5 : 1;
  return (
    (scale * (input * 0.1 + output * 0.5 + read * 0.01 + fiveMinutes * 0.125 + oneHour * 0.2)) / 1_000_000
  );
}

// Wire allowances: the default judge's output room (answer budget plus thinking room), so a model that thinks by
// default is not cut before its answer. Checked against the public client's oracle in the recorder tests.
// These are transport settings, not criterion, prompt or decoder policy.
const MESSAGES_OUTPUT_LIMITS = {
  normal: outputRoom('normal', undefined),
  large: outputRoom('large', undefined),
} as const;
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MESSAGES_DIALECT = 'scratchpad-json';

/** Preserve the existing cassette transport identity: SHA-256 of canonical JSON, first 12 hex digits. */
function transportFingerprint(value: unknown): string {
  const sorted = (part: unknown): unknown => {
    if (Array.isArray(part)) return part.map(sorted);
    if (part !== null && typeof part === 'object')
      return Object.fromEntries(
        Object.entries(part)
          .filter(([, child]) => child !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sorted(child)]),
      );
    return part;
  };
  return createHash('sha256')
    .update(JSON.stringify(sorted(value)))
    .digest('hex')
    .slice(0, 12);
}

function retryAfterMs(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms')?.trim();
  if (ms && /^\d+(\.\d+)?$/.test(ms)) return Math.round(Number(ms));
  const value = headers.get('retry-after')?.trim();
  if (value === undefined) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  if (!/[a-z]/i.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

/** HTTP plumbing only. Prompt construction and answer interpretation stay in the allowed public API. */
function messagesApiJudge(
  model: string,
  env: Record<string, string | undefined>,
  fetch: typeof globalThis.fetch,
): JudgeClient {
  // Construction is also used by free cassette replay. No placeholder credential goes onto the wire.
  const key = env.ANTHROPIC_API_KEY?.trim();
  const fingerprints = Object.fromEntries(
    Object.entries(MESSAGES_OUTPUT_LIMITS).map(([budget, maxTokens]) => [
      budget,
      transportFingerprint({
        version: 1,
        provider: 'anthropic',
        dialect: MESSAGES_DIALECT,
        model,
        maxTokens,
        base: 'https://api.anthropic.com',
      }),
    ]),
  );
  return {
    id: 'haiku',
    family: 'anthropic',
    cls: 'system2',
    model,
    dialect: MESSAGES_DIALECT,
    cost: 10,
    settings: JSON.stringify({
      client: 'criterion-messages-api-v1',
      model,
      anthropicVersion: '2023-06-01',
      temperature: 'omitted',
      maxTokens: MESSAGES_OUTPUT_LIMITS,
      schema: 'none',
      transportFingerprints: fingerprints,
    }),
    async judge(original) {
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      // Other identities can be inspected offline, but cannot borrow Haiku 5.5 pricing.
      if (model !== 'claude-haiku-5-5')
        throw new Error('Messages API recorder has no metered rates for this model');
      // A caller cannot select a schema-only output dialect for this text transport.
      const request =
        original.answerContract === 'ledger' &&
        original.assessment?.kind === 'pairwise' &&
        !original.assessment.tieFollowup
          ? { ...original, dialect: MESSAGES_DIALECT }
          : original;
      const budget = request.budget ?? 'normal';
      const maxTokens = MESSAGES_OUTPUT_LIMITS[budget];
      if (!maxTokens) throw new Error('Unsupported output budget');
      const prompt = buildPrompt(request);
      const payload = { system: prompt.system, messages: [{ role: 'user', content: prompt.user }] };
      const body = JSON.stringify({ model, ...payload, max_tokens: maxTokens });
      let response: Response;
      let raw: string;
      try {
        response = await fetch(MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(300_000),
        });
        raw = await response.text();
      } catch (cause) {
        throw Object.assign(
          new Error(
            `${MESSAGES_URL} could not be reached (${cause instanceof Error ? cause.name : 'error'})`,
          ),
          { name: 'JudgeError', code: 'network', retryable: true },
        );
      }
      let value: Record<string, unknown> | undefined;
      try {
        value = JSON.parse(raw);
      } catch {
        /* HTTP errors need not have JSON bodies. */
      }
      if (!response.ok) {
        const error = value?.error;
        let said =
          error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : typeof error === 'string'
              ? error
              : typeof value?.message === 'string'
                ? value.message
                : raw.trim()
                  ? raw
                  : 'no body';
        for (const secret of [key, '2023-06-01']) said = said.split(secret).join('[redacted]');
        if (said.length > 200) said = `${said.slice(0, 200)}...`;
        throw Object.assign(new Error(`${MESSAGES_URL} answered ${response.status}: ${said}`), {
          name: 'JudgeError',
          code: 'http',
          status: response.status,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          retryAfterMs: retryAfterMs(response.headers),
        });
      }
      if (value === undefined)
        throw Object.assign(
          new Error(`${MESSAGES_URL} answered ${response.status} with a body that is not JSON`),
          { name: 'JudgeError', code: 'bad_response', retryable: false },
        );
      const text = Array.isArray(value?.content)
        ? value.content
            .filter(
              (part): part is { text: string } =>
                part !== null &&
                typeof part === 'object' &&
                part.thought !== true &&
                typeof part.text === 'string',
            )
            .map((part) => part.text)
            .join('')
        : '';
      const finish = value?.stop_reason;
      if (finish === 'refusal') {
        const usage = value?.usage as AnthropicUsage | undefined;
        const input = usage?.input_tokens,
          output = usage?.output_tokens;
        const tokens = {
          ...(typeof input === 'number' && Number.isFinite(input) && input >= 0 ? { input } : {}),
          ...(typeof output === 'number' && Number.isFinite(output) && output >= 0 ? { output } : {}),
        };
        return {
          dialect: MESSAGES_DIALECT,
          fingerprint: transportFingerprint({
            transport: fingerprints[budget],
            request: transportFingerprint({
              version: 1,
              provider: 'anthropic',
              dialect: MESSAGES_DIALECT,
              payload,
            }),
          }),
          text,
          raw: JSON.stringify(value),
          ...(Object.keys(tokens).length ? { usage: tokens } : {}),
          finishReason: finish,
          refusal: finish,
          declineReason: 'provider-blocked',
          providerBlock: { provider: 'anthropic', reason: 'refusal' },
          answer: { outcome: 'inconclusive', reasoning: 'Provider declined' },
        };
      }
      if (['length', 'MAX_TOKENS', 'max_tokens'].includes(String(finish)))
        return {
          raw: text,
          answer: { outcome: 'inconclusive', reasoning: 'Answer truncated' },
          unparsed: true,
        };
      return parseJudgeText(text, request);
    },
  };
}

export function makeRecordingClient(
  model: string,
  budget: SpendBudget,
  env: Record<string, string | undefined>,
  log: (row: SpendRow) => void,
  options: { haikuModel?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): JudgeClient {
  if (!['haiku', 'gpt-6-luna', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'].includes(model))
    throw new Error(`Recording model ${model} is not enabled`);
  for (const key of [
    'OPENAI_BASE_URL',
    'OPENAI_JUDGE_MODEL',
    'CLAUDE_JUDGE_MODEL',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_JUDGE_MODEL',
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
    requestCount: number;
    failure?: unknown;
    pending?: { token: symbol; amount: number; rejected?: boolean };
  };
  const meter = new AsyncLocalStorage<Meter>();
  const isAnthropic = model === 'haiku';
  const isGemini = model === 'gemini-3.8-flash' || model === 'gemini-3.5-flash-lite';
  const rates = model === 'gemini-3.5-flash-lite' ? GEMINI_LITE_RATES : isGemini ? GEMINI_RATES : LUNA_RATES;
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
      const body = JSON.parse(init.body) as { max_completion_tokens?: number; max_tokens?: number };
      // Reserve each wire request, including a recovery with a larger output allowance.
      // Gemini thinking may overshoot the requested cap, so reserve its full model ceiling.
      // https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
      const outputLimit = isGemini ? 65_536 : isAnthropic ? body.max_tokens : body.max_completion_tokens;
      if (outputLimit === undefined || !Number.isSafeInteger(outputLimit) || outputLimit <= 0)
        throw new Error('Recorder requires a bounded output allowance');
      const amount =
        // Haiku reserves the long-context ceiling, including one-hour cache creation.
        ((Buffer.byteLength(init.body) + 8192) * (isAnthropic ? 1 : rates.input) +
          outputLimit * (isAnthropic ? 2.5 : rates.output)) /
        1_000_000;
      // Rejected HTTP attempts can reuse their held allowance. A terminal error retains it.
      if (current.pending && (!current.pending.rejected || current.pending.amount < amount))
        settle(current, current.pending.rejected ? 0 : undefined);
      current.pending ??= { token: budget.reserve(amount), amount };
      current.pending.rejected = false;
    } catch (cause) {
      current.failure = cause;
      throw cause;
    }
    current.requestCount += 1;
    // Observe the response; do not rewrite the public client's request or answer.
    const response = await (options.fetch ?? fetch)(url, init);
    if (isAnthropic) {
      // Every physical attempt owns a reservation. Unknown rejected charges are retained, not reused.
      let usage: AnthropicUsage | undefined;
      let resolvedModel: string | undefined;
      try {
        const payload = (await response.clone().json()) as { usage?: AnthropicUsage; model?: string };
        usage = payload.usage;
        resolvedModel = payload.model;
      } catch {
        /* Non-JSON HTTP errors have unknown usage. */
      }
      if (usage) {
        const cost = anthropicCost(usage);
        current.cost = (current.cost ?? 0) + cost;
        current.model = resolvedModel ?? current.model;
        current.input =
          (current.input ?? 0) +
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        current.output = (current.output ?? 0) + (usage.output_tokens ?? 0);
        settle(current, cost);
      } else {
        settle(current, undefined);
        if (response.ok) throw new Error('Anthropic response has no usage');
      }
    } else if (response.ok) {
      const payload = (await response.clone().json()) as {
        usage?: Usage;
        model?: string;
        usageMetadata?: GeminiUsage;
        modelVersion?: string;
      };
      let cost: number;
      if (isGemini) {
        if (!payload.usageMetadata) throw new Error('Gemini response has no usage');
        cost = geminiCost(payload.usageMetadata, rates);
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
      ? messagesApiJudge(actualModel, env, observedFetch as typeof fetch)
      : isGemini
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
      const data: Meter = { charged: 0, unmetered: false, requestCount: 0 };
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
                !(isGemini || isAnthropic) ||
                !(cause instanceof Error) ||
                !('status' in cause) ||
                !(
                  cause.status === 429 ||
                  (isAnthropic && typeof cause.status === 'number' && cause.status >= 500)
                ) ||
                attempt >= 3
              )
                throw cause;
              // Retry explicit transient HTTP responses only; network/usage failures retain their allowance and stop.
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
          return {
            ...result,
            requestCount: data.requestCount,
            ...(data.unmetered
              ? { costUsd: undefined, costIncomplete: true as const }
              : { costUsd: data.cost }),
          };
        });
      } finally {
        // Even an overrun must reach the append-only spend ledger before it stops the run.
        try {
          settle(data, undefined);
        } finally {
          if (data.requestCount > 0)
            log({
              at: new Date().toISOString(),
              model,
              resolvedModel: data.model ?? actualModel,
              costUsd: data.cost ?? 0,
              chargedUsd: data.charged,
              accounting: data.unmetered ? 'reserved-on-error' : 'tokens',
              status,
              ...(data.input === undefined ? {} : { inputTokens: data.input, outputTokens: data.output }),
            });
        }
      }
    },
  };
}
