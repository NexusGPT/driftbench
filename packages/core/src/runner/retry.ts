import { AdapterTransportError } from '../contracts/adapter';

export type RetryOptions = {
  /** Retries after the first attempt, for transport errors only. Default 3. */
  retries?: number;
  /** The wait before the first retry; each later retry doubles it. Default 200 ms. */
  baseDelayMs?: number;
  /** How the runner waits between attempts. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

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
 * Runs one adapter call. An AdapterTransportError is retried with exponential backoff; any other error,
 * an AgentFailure first of all, fails at once. The error thrown in the end is a CallFailure.
 */
export async function withRetry<T>(
  call: string,
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const sleep = options.sleep ?? wait;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (cause) {
      if (!isTransportError(cause) || attempt > retries) throw new CallFailure(call, attempt, cause);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
