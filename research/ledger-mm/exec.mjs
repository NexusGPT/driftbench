// TEST execution rules (owner amendment): transport-only retries and a global call limit.
// A returned model answer is never retried. Scoring, prompts and the pool are untouched.

export const TRIES = 3;
export const TIMEOUT_MS = 300_000;
export const BACKOFF_MS = [0, 15_000, 45_000];
export const MAX_CONCURRENT_CALLS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = []; }
  async acquire() {
    if (this.active < this.limit) { this.active++; return () => this.release(); }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Runs `attempt(n)` until a model answer returns. `attempt` throws only when no answer arrived.
 * `before(n)` runs ahead of each try and may throw a cap error, which stops at once.
 * `failed(n, error)` records each failed try. `classify(error)` may return 'stop' (halt the
 * whole run at once, no retry) or 'rate' (a rate limit: wait rateWaitsMs[k] after the k-th one).
 * Other failures retry up to `tries` in total with `backoffMs`. Exhaustion throws
 * TRANSPORT_EXHAUSTED with the final error.
 */
export async function withTransportRetry({ attempt, before = () => {}, failed = () => {}, tries = TRIES, backoffMs = BACKOFF_MS, wait = sleep, first = 1, classify = () => 'retry', rateWaitsMs = null }) {
  let last, lastN = first - 1, rate = 0, other = Math.max(0, first - 1), n = first;
  const maxTries = rateWaitsMs ? Math.max(tries, rateWaitsMs.length + 1) : tries;
  for (;;) {
    if (n > maxTries) break;
    before(n);
    lastN = n;
    try {
      return await attempt(n);
    } catch (error) {
      last = error;
      failed(n, error);
      const kind = classify(error);
      if (kind === 'stop') {
        const stop = new Error(`PROVIDER_PAYMENT_STOP: ${String(error?.message ?? error)}`);
        stop.providerStop = true;
        throw stop;
      }
      let delay;
      if (kind === 'rate' && rateWaitsMs) {
        rate++;
        if (rate > rateWaitsMs.length) break;
        delay = rateWaitsMs[rate - 1];
      } else {
        other++;
        if (other >= tries) break;
        delay = backoffMs[Math.min(other, backoffMs.length - 1)];
      }
      n++;
      if (n > maxTries) break;
      await wait(delay);
    }
  }
  const error = new Error(`TRANSPORT_EXHAUSTED after ${lastN} tries: ${String(last?.message ?? last)}`);
  error.transportExhausted = true;
  throw error;
}

/** Per-model pacing. gemini-3.5-flash-lite: owner rule, 8 calls at once, 429 waits 20, 60, 180 s, 402 stops. */
export const PACING = {
  'gemini-3.5-flash-lite': { concurrency: 8, rateWaitsMs: [20_000, 60_000, 180_000], stopOn402: true },
};
export function classifyHttp(error, pacing) {
  const text = String(error?.message ?? error);
  if (pacing?.stopOn402 && /answered 402\b/.test(text)) return 'stop';
  if (pacing?.rateWaitsMs && /answered 429\b/.test(text)) return 'rate';
  return 'retry';
}

// Network-pause rules (amendment 8). A transport no-answer is not a spent item: it is recovered later.
/** No model output arrived and the item may be asked again: unreachable host, timeout, or HTTP 5xx. */
export const isRecoverable = (text) => /could not be reached|answered 5\d\d\b|claude envelope no-answer|without a JSON result|claude ran past/.test(String(text));
/** The provider processed nothing, so the try costs zero. A timeout is excluded: its cost is unknown. */
export const isZeroCost = (text) => /could not be reached \(TypeError\)|answered 5\d\d\b/.test(String(text));
/** Connection-class failure, for the pause rule. */
export const isConnectionFailure = (text) => /could not be reached|claude envelope no-answer|without a JSON result|claude ran past/.test(String(text));

/** Pauses the run after `limit` consecutive connection-class failures. Any answer resets the count. */
export class LinkMonitor {
  constructor(limit = 3) { this.limit = limit; this.run = 0; this.paused = false; }
  answered() { this.run = 0; }
  failed(text) {
    if (!isConnectionFailure(text)) { this.run = 0; return; }
    if (++this.run >= this.limit) this.paused = true;
  }
}

/**
 * Reads a Claude CLI JSON envelope (amendment 9). Zero output tokens on an error envelope means no
 * model output arrived: a transport no-answer at its reported cost. Any output tokens on an error
 * envelope is an answer or a model-side failure, which is final and never re-sent.
 */
export function readClaudeEnvelope(stdout, code) {
  let value;
  try { value = JSON.parse(stdout); } catch { return { kind: 'no-envelope' }; }
  if (!value || typeof value !== 'object' || value.type !== 'result') return { kind: 'no-envelope' };
  const cost = typeof value.total_cost_usd === 'number' && Number.isFinite(value.total_cost_usd) && value.total_cost_usd >= 0 ? value.total_cost_usd : undefined;
  const reason = String(value.terminal_reason ?? value.subtype ?? 'unknown');
  if (value.is_error !== true && code === 0)
    return { kind: 'answer', cost, text: typeof value.result === 'string' ? value.result : '', finishReason: typeof value.subtype === 'string' ? value.subtype : undefined, truncated: value.subtype !== 'success' };
  const output = Number(value.usage?.output_tokens ?? 0);
  // Amendment 13: the provider's safeguards refused the input. This is a deterministic provider decision,
  // not a transport failure: it is final, never re-sent, and never counts as a connection failure.
  if (output === 0 && /safeguards flagged/i.test(String(value.result ?? ''))) return { kind: 'provider-block', cost, reason: 'safeguards' };
  return output > 0 ? { kind: 'model-failure', cost, reason } : { kind: 'no-answer', cost, reason };
}
