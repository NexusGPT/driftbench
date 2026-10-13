import { AsyncLocalStorage } from 'node:async_hooks';
import { AdapterTransportError, AgentFailure } from '../contracts/adapter';
import type { RetrySettings } from '../schema/common';
import type { RetryEvent } from '../schema/run';

/**
 * The one retry policy of every model-facing call: the adapters that call a model, the runner around every
 * adapter call, and the judge clients.
 *
 * Only a transient failure is retried: an HTTP 408, a 429, a 5xx (an overloaded 529 included), or a network error
 * (refused, reset, unreachable, timed out). Waits grow exponentially from a base up to a cap, drawn at
 * random below the backoff (full jitter), and never shorter than the server's Retry-After. Every retry is
 * reported: to an `onRetry` callback, and to the innermost `collectRetries` scope, which is how the runner
 * puts the retries of a block into its Observed and the council puts a judge's retries into its vote.
 */

/** The policy in code form. `retryPolicy` builds one from layers of settings. */
export type RetryPolicy = {
  /** Attempts per call, the first included. */
  readonly maxAttempts: number;
  /** The wait before the first retry; each later retry doubles it. */
  readonly baseDelayMs: number;
  /** The longest wait between two attempts. A Retry-After above it ends the retries. */
  readonly maxDelayMs: number;
  /** Draw each wait at random below the backoff. */
  readonly jitter: boolean;
  /** Wait at least what the server's Retry-After asks. */
  readonly retryAfter: boolean;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
  retryAfter: true,
});

/** Settings in either spelling: the spec's snake case or the code's camel case. */
export type RetryLayer = Partial<RetryPolicy> | RetrySettings;

/** The policy that layers the given settings over the default; a later layer wins, an absent key keeps. */
export function retryPolicy(...layers: (RetryLayer | undefined)[]): RetryPolicy {
  let policy: RetryPolicy = DEFAULT_RETRY_POLICY;
  for (const layer of layers) {
    if (!layer) continue;
    const read = layer as Record<string, unknown>;
    const pick = <K extends keyof RetryPolicy>(key: K, snake: string): RetryPolicy[K] =>
      (read[key] ?? read[snake] ?? policy[key]) as RetryPolicy[K];
    policy = {
      maxAttempts: pick('maxAttempts', 'max_attempts'),
      baseDelayMs: pick('baseDelayMs', 'base_delay_ms'),
      maxDelayMs: pick('maxDelayMs', 'max_delay_ms'),
      jitter: pick('jitter', 'jitter'),
      retryAfter: pick('retryAfter', 'retry_after'),
    };
  }
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error(`retry max_attempts takes a whole number of at least 1, not ${policy.maxAttempts}`);
  }
  for (const [key, value] of [
    ['base_delay_ms', policy.baseDelayMs],
    ['max_delay_ms', policy.maxDelayMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`retry ${key} takes a number of at least 0, not ${value}`);
  }
  return policy;
}

/** What the policy reads from a failure: whether to retry, the status, the Retry-After wait. */
export type RetryDecision = { retry: boolean; status?: number; retryAfterMs?: number; reason: string };

const NETWORK_NAME = /connection|timeout|abort|fetcherror|network|socket/i;
const NETWORK_CODE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** True for a status worth trying again: 408, 429, or any 5xx. */
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Reads a failure the way the policy needs it. The status is read where the SDKs put it (`status`,
 * `statusCode`, `response.status`); the Retry-After from `retryAfterMs`, or the `retry-after-ms` or
 * `retry-after` header of `headers`, `responseHeaders` or `response.headers`. A failure with no status
 * is retried when it is a network error, by its name or code or those of its causes. An `AgentFailure`, a
 * transport error already retried in full, and any other error are not.
 */
export function retryDecision(error: unknown, now: number = Date.now()): RetryDecision {
  const reason = describe(error);
  if (error instanceof AgentFailure) return { retry: false, reason };
  if (isRecord(error) && error.exhausted === true) return { retry: false, reason };
  const status = statusOf(error);
  const retryAfterMs = retryAfterOf(error, now);
  const known = {
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
  if (status !== undefined) return { retry: retryableStatus(status), ...known, reason };
  const network = error instanceof AdapterTransportError || isNetwork(error);
  return { retry: network, ...known, reason };
}

/** A Retry-After value in milliseconds: delay seconds, or an HTTP date (a past date reads 0). */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  if (!/[a-z]/i.test(text)) return undefined;
  const when = Date.parse(text);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now);
}

/** The backoff before retry `attempt` (the attempt that failed, from 1): base doubled per attempt, capped, jittered. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return policy.jitter ? Math.floor(random() * ceiling) : ceiling;
}

export type RetryingOptions = {
  policy?: RetryPolicy;
  /** How a wait is spent. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  /** The jitter's random source, in [0, 1). */
  random?: () => number;
  /** The clock, for event times and Retry-After dates. */
  now?: () => number;
  /** Told about every retry, before the wait. */
  onRetry?: (event: RetryEvent) => void;
  /** Decides what to retry. Default `retryDecision`. */
  decide?: (error: unknown, now: number) => RetryDecision;
};

/**
 * Runs one call under the policy. A transient failure is retried until `maxAttempts`; the error thrown in
 * the end is an `AdapterTransportError` marked `exhausted`, naming the call and the attempts, with the
 * last failure as its cause. A failure that is not transient is thrown as it came, on its first attempt.
 * A Retry-After longer than `maxDelayMs` ends the retries at once.
 */
export async function retrying<T>(
  call: string,
  run: (attempt: number) => Promise<T>,
  options: RetryingOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? wait;
  const clock = options.now ?? Date.now;
  const decide = options.decide ?? retryDecision;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      const decision = decide(error, clock());
      if (!decision.retry) throw error;
      const exhausted = (why: string) =>
        new AdapterTransportError(`${call} failed ${why}: ${decision.reason}`, {
          cause: error,
          exhausted: true,
          attempts: attempt,
          ...(decision.status === undefined ? {} : { status: decision.status }),
          ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
        });
      if (attempt >= policy.maxAttempts) {
        throw exhausted(attempt === 1 ? 'and the policy allows 1 attempt' : `after ${attempt} attempts`);
      }
      const asked = policy.retryAfter ? decision.retryAfterMs : undefined;
      if (asked !== undefined && asked > policy.maxDelayMs) {
        throw exhausted(
          `on attempt ${attempt}: Retry-After asks for ${asked} ms, more than max_delay_ms ${policy.maxDelayMs}`,
        );
      }
      const delayMs = Math.max(backoffDelay(attempt, policy, options.random), asked ?? 0);
      const event: RetryEvent = {
        call,
        attempt,
        ...(decision.status === undefined ? {} : { status: decision.status }),
        reason: decision.reason,
        delayMs,
        ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
        at: new Date(clock()).toISOString(),
      };
      options.onRetry?.(event);
      scope.getStore()?.push(event);
      await sleep(delayMs);
    }
  }
}

const scope = new AsyncLocalStorage<RetryEvent[]>();

/**
 * Runs `work` in a scope that gathers every retry made inside it, however deep, and returns them with the
 * value. Scopes nest: a retry goes to the innermost one only. Parallel scopes stay apart.
 */
export async function collectRetries<T>(
  work: () => Promise<T>,
): Promise<{ value: T; retries: RetryEvent[] }> {
  const retries: RetryEvent[] = [];
  const value = await retriesInto(retries, work);
  return { value, retries };
}

/** Runs `work` in a scope whose retries go to `log`, kept also when `work` fails in the end. */
export function retriesInto<T>(log: RetryEvent[], work: () => Promise<T>): Promise<T> {
  return scope.run(log, work);
}

/** Records a retry made outside `retrying` (a client with its own loop) in the current scope. */
export function recordRetry(event: RetryEvent): void {
  scope.getStore()?.push(event);
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  for (const value of [
    error.status,
    error.statusCode,
    isRecord(error.response) ? error.response.status : undefined,
  ]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

function retryAfterOf(error: unknown, now: number): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.retryAfterMs === 'number' && error.retryAfterMs >= 0) return error.retryAfterMs;
  const sources = [
    error.headers,
    error.responseHeaders,
    isRecord(error.response) ? error.response.headers : undefined,
  ];
  for (const headers of sources) {
    const ms = header(headers, 'retry-after-ms');
    if (ms !== undefined && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
    const after = parseRetryAfter(header(headers, 'retry-after'), now);
    if (after !== undefined) return after;
  }
  return undefined;
}

function header(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!isRecord(headers)) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}

function isNetwork(error: unknown, depth = 0): boolean {
  if (depth > 4 || !isRecord(error)) return false;
  if (typeof error.name === 'string' && NETWORK_NAME.test(error.name)) return true;
  if (typeof error.code === 'string' && NETWORK_CODE.has(error.code)) return true;
  if (typeof error.message === 'string' && /^fetch failed$/i.test(error.message)) return true;
  return isNetwork(error.cause, depth + 1);
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
