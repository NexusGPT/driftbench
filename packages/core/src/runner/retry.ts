import { AdapterTransportError } from '../contracts/adapter';
import {
  type RetryDecision,
  type RetryLayer,
  type RetryPolicy,
  retryDecision,
  retrying,
  retryPolicy,
} from '../retry';

/**
 * The runner's retry settings. The policy is the shared one (`retryPolicy`): the spec target's `retry`
 * first, then these settings over it, the command line's included.
 */
export type RetryOptions = {
  /** Retries after the first attempt. Default 3 (four attempts). Same as `maxAttempts` minus one. */
  retries?: number;
  /** Attempts per call, the first included. */
  maxAttempts?: number;
  /** The wait before the first retry; each later retry doubles it. Default 500 ms. */
  baseDelayMs?: number;
  /** The longest wait between two attempts. Default 30000 ms. */
  maxDelayMs?: number;
  /** Draw each wait at random below the backoff. Default true. */
  jitter?: boolean;
  /** Wait at least the server's Retry-After. Default true. */
  retryAfter?: boolean;
  /** How the runner waits between attempts. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  /** The jitter's random source, in [0, 1). */
  random?: () => number;
};

/** The settings of `RetryOptions` as a policy layer: `retries` becomes `maxAttempts`. */
export function retryLayer(options: RetryOptions | undefined): RetryLayer | undefined {
  if (!options) return undefined;
  const maxAttempts =
    options.maxAttempts ?? (options.retries === undefined ? undefined : options.retries + 1);
  return {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
    ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
    ...(options.jitter === undefined ? {} : { jitter: options.jitter }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  };
}

/** An adapter call that failed for good: the message names the call, the attempts and the cause. */
export class CallFailure extends Error {
  constructor(
    readonly call: string,
    readonly attempts: number,
    cause: unknown,
  ) {
    const after = attempts > 1 ? ` after ${attempts} attempts` : '';
    super(`${call} failed${after}: ${describeError(cause)}`, { cause });
    this.name = 'CallFailure';
  }
}

/**
 * Runs one adapter call under the shared policy. Only a transport error is retried, and only when it is
 * transient: a 429 or a 5xx when it carries a status, a network failure when it does not, never one the
 * adapter already retried in full (`exhausted`). An AgentFailure fails at once. Each retry goes to the
 * current `collectRetries` scope. The error thrown in the end is a CallFailure.
 */
export async function withRetry<T>(
  call: string,
  run: () => Promise<T>,
  options: RetryOptions = {},
  policy: RetryPolicy = retryPolicy(retryLayer(options)),
): Promise<T> {
  let attempts = 0;
  let last: unknown;
  try {
    return await retrying(
      call,
      async (attempt) => {
        attempts = attempt;
        try {
          return await run();
        } catch (error) {
          last = error;
          throw error;
        }
      },
      {
        policy,
        ...(options.sleep ? { sleep: options.sleep } : {}),
        ...(options.random ? { random: options.random } : {}),
        decide: runnerDecision,
      },
    );
  } catch (error) {
    // Retries spent here end in an exhausted error around the last failure: report that failure.
    const own = error !== last && error instanceof AdapterTransportError && error.exhausted;
    throw new CallFailure(call, attempts, own ? last : error);
  }
}

/** A transport error is retried as the policy says; one with no status is a network failure. */
function runnerDecision(error: unknown, now: number): RetryDecision {
  const decision = retryDecision(error, now);
  if (!isTransportError(error)) return { ...decision, retry: false };
  const exhausted = (error as { exhausted?: unknown }).exhausted === true;
  if (decision.status === undefined && !exhausted) return { ...decision, retry: true };
  return decision;
}

/** Also recognises a transport error from a second copy of the core module, by its name and flag. */
export function isTransportError(error: unknown): boolean {
  if (error instanceof AdapterTransportError) return true;
  return (
    error instanceof Error &&
    error.name === 'AdapterTransportError' &&
    (error as { retryable?: unknown }).retryable === true
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
