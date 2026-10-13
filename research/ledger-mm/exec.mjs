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
