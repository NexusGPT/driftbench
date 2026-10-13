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
 * Runs `attempt(n)` up to `tries` times. `attempt` returns { answer } when the model returned
 * anything, and throws only when no answer arrived (transport failure). `before(n)` runs ahead of
 * each try and may throw a cap error, which stops retrying at once. `failed(n, error)` records each
 * failed try. After the last try the function throws TRANSPORT_EXHAUSTED with the final error.
 */
export async function withTransportRetry({ attempt, before = () => {}, failed = () => {}, tries = TRIES, backoffMs = BACKOFF_MS, wait = sleep }) {
  let last;
  for (let n = 1; n <= tries; n++) {
    if (n > 1) await wait(backoffMs[Math.min(n - 1, backoffMs.length - 1)]);
    before(n);
    try {
      return await attempt(n);
    } catch (error) {
      last = error;
      failed(n, error);
    }
  }
  const error = new Error(`TRANSPORT_EXHAUSTED after ${tries} tries: ${String(last?.message ?? last)}`);
  error.transportExhausted = true;
  throw error;
}
