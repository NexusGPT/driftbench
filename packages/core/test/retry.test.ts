import { describe, expect, it } from 'vitest';
import {
  AdapterTransportError,
  AgentFailure,
  backoffDelay,
  collectRetries,
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  RetryEvent,
  RetrySettings,
  retryDecision,
  retrying,
  retryPolicy,
  TargetRef,
} from '../src/index';

/** An error shaped like a vendor SDK's: a status, and headers when the API sent them. */
function apiError(status: number, headers: Record<string, string> = {}, name = 'APIError') {
  return Object.assign(new Error(`status ${status}`), { name, status, headers: new Headers(headers) });
}

const noJitter = retryPolicy({ jitter: false, baseDelayMs: 100, maxDelayMs: 1_000 });

describe('retry decision', () => {
  it('retries 408, 429, 529 and every 5xx, and never another status', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(retryDecision(apiError(status)).retry, `status ${status}`).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(retryDecision(apiError(status)).retry, `status ${status}`).toBe(false);
    }
  });

  it('reads the status a vendor puts under another name, and a Retry-After header in its forms', () => {
    expect(retryDecision({ statusCode: 503, responseHeaders: { 'retry-after': '2' } })).toMatchObject({
      retry: true,
      status: 503,
      retryAfterMs: 2_000,
    });
    expect(retryDecision(apiError(429, { 'retry-after-ms': '1500' }))).toMatchObject({ retryAfterMs: 1_500 });
    expect(
      retryDecision(
        Object.assign(new Error('x'), {
          response: { status: 429, headers: new Headers({ 'retry-after': '3' }) },
        }),
      ),
    ).toMatchObject({ retry: true, status: 429, retryAfterMs: 3_000 });
    expect(
      retryDecision(new AdapterTransportError('busy', { status: 429, retryAfterMs: 750 })),
    ).toMatchObject({
      retry: true,
      status: 429,
      retryAfterMs: 750,
    });
  });

  it('retries a network error by name, code or cause, and never an agent failure or a plain error', () => {
    expect(retryDecision(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })).retry).toBe(
      true,
    );
    expect(
      retryDecision(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })).retry,
    ).toBe(true);
    expect(retryDecision(Object.assign(new Error('socket'), { code: 'ECONNRESET' })).retry).toBe(true);
    expect(retryDecision(Object.assign(new Error('slow'), { name: 'TimeoutError' })).retry).toBe(true);
    expect(retryDecision(new AdapterTransportError('socket hang up')).retry).toBe(true);
    expect(retryDecision(new AgentFailure('the agent crashed')).retry).toBe(false);
    expect(retryDecision(new Error('bad model id')).retry).toBe(false);
    expect(retryDecision(new AdapterTransportError('already retried', { exhausted: true })).retry).toBe(
      false,
    );
  });

  it('parses Retry-After as seconds or as an HTTP date, and nothing else', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    expect(parseRetryAfter('7', now)).toBe(7_000);
    expect(parseRetryAfter('0.5', now)).toBe(500);
    expect(parseRetryAfter('Mon, 12 Oct 2026 10:00:04 GMT', now)).toBe(4_000);
    expect(parseRetryAfter('Mon, 12 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });
});

describe('backoff', () => {
  it('doubles from the base up to the cap, and full jitter draws below it', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoffDelay(attempt, noJitter))).toEqual([
      100, 200, 400, 800, 1_000,
    ]);
    const jittered = retryPolicy({ baseDelayMs: 100, maxDelayMs: 1_000 });
    expect(backoffDelay(3, jittered, () => 0.25)).toBe(100);
    expect(backoffDelay(3, jittered, () => 0)).toBe(0);
    expect(backoffDelay(9, jittered, () => 0.999)).toBeLessThanOrEqual(1_000);
  });

  it('layers settings over the default, the last one winning, spec keys and code keys alike', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitter: true,
      retryAfter: true,
    });
    expect(retryPolicy({ max_attempts: 2, jitter: false }, undefined, { maxAttempts: 6 })).toEqual({
      maxAttempts: 6,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitter: false,
      retryAfter: true,
    });
    expect(() => retryPolicy({ maxAttempts: 0 })).toThrow(/max_attempts/);
  });
});

describe('retrying', () => {
  it('fails twice with 429 then 529, waits, records both retries, and returns the answer', async () => {
    let calls = 0;
    const waits: number[] = [];
    const events: RetryEvent[] = [];
    const answer = await retrying(
      'messages.create',
      async (attempt) => {
        calls += 1;
        expect(attempt).toBe(calls);
        if (calls === 1) throw apiError(429, { 'retry-after': '0.3' });
        if (calls === 2) throw apiError(529, {}, 'InternalServerError');
        return 'ok';
      },
      { policy: noJitter, sleep: async (ms) => void waits.push(ms), onRetry: (event) => events.push(event) },
    );
    expect(answer).toBe('ok');
    expect(calls).toBe(3);
    expect(waits, 'Retry-After 0.3 s outweighs the 100 ms backoff').toEqual([300, 200]);
    expect(events.map(({ at: _at, ...rest }) => rest)).toEqual([
      {
        call: 'messages.create',
        attempt: 1,
        status: 429,
        reason: 'APIError: status 429',
        delayMs: 300,
        retryAfterMs: 300,
      },
      {
        call: 'messages.create',
        attempt: 2,
        status: 529,
        reason: 'InternalServerError: status 529',
        delayMs: 200,
      },
    ]);
    for (const event of events) expect(RetryEvent.safeParse(event).success).toBe(true);
  });

  it('stops at max attempts and throws the last error, marked exhausted', async () => {
    let calls = 0;
    const failure = await retrying(
      'generateContent',
      async () => {
        calls += 1;
        throw apiError(503);
      },
      { policy: retryPolicy(noJitter, { maxAttempts: 3 }), sleep: async () => {} },
    ).catch((error: unknown) => error);
    expect(calls).toBe(3);
    expect(failure).toBeInstanceOf(AdapterTransportError);
    expect(failure).toMatchObject({ exhausted: true, status: 503, attempts: 3 });
    expect((failure as Error).message).toBe('generateContent failed after 3 attempts: APIError: status 503');
  });

  it('never retries what is not transient, and throws it as it came', async () => {
    let calls = 0;
    const refused = apiError(400);
    const failure = await retrying(
      'create',
      async () => {
        calls += 1;
        throw refused;
      },
      { policy: noJitter, sleep: async () => {} },
    ).catch((error: unknown) => error);
    expect(calls).toBe(1);
    expect(failure).toBe(refused);
  });

  it('gives up when Retry-After asks for more than the longest wait, without waiting', async () => {
    let calls = 0;
    const waits: number[] = [];
    const failure = await retrying(
      'create',
      async () => {
        calls += 1;
        throw apiError(429, { 'retry-after': '120' });
      },
      { policy: noJitter, sleep: async (ms) => void waits.push(ms) },
    ).catch((error: unknown) => error);
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
    expect((failure as Error).message).toMatch(/Retry-After asks for 120000 ms, more than max_delay_ms 1000/);
  });

  it('ignores Retry-After when the policy says so', async () => {
    const waits: number[] = [];
    let calls = 0;
    await retrying(
      'create',
      async () => {
        calls += 1;
        if (calls === 1) throw apiError(429, { 'retry-after': '120' });
        return 1;
      },
      { policy: retryPolicy(noJitter, { retryAfter: false }), sleep: async (ms) => void waits.push(ms) },
    );
    expect(waits).toEqual([100]);
  });

  it('hands every retry inside a scope to the scope, nested scopes to the innermost', async () => {
    /** A call that fails once with a 500, then answers: one retry each time. */
    const flaky = () =>
      retrying(
        'inner',
        async (attempt) => {
          if (attempt === 1) throw apiError(500);
          return attempt;
        },
        { policy: noJitter, sleep: async () => {} },
      );
    const outer = await collectRetries(async () => {
      await flaky();
      const inner = await collectRetries(flaky);
      expect(inner.retries).toHaveLength(1);
      return 'done';
    });
    expect(outer.value).toBe('done');
    expect(outer.retries.map((event) => event.call)).toEqual(['inner']);
    const parallel = await Promise.all([collectRetries(flaky), collectRetries(flaky)]);
    expect(parallel.map((entry) => entry.retries.length)).toEqual([1, 1]);
  });
});

describe('the spec target', () => {
  it('takes a retry block in snake case, and refuses an unknown key', () => {
    expect(
      TargetRef.parse({ adapter: 'http', retry: { max_attempts: 5, base_delay_ms: 250 } }).retry,
    ).toEqual({
      max_attempts: 5,
      base_delay_ms: 250,
    });
    expect(TargetRef.safeParse({ adapter: 'http', retry: { attempts: 5 } }).success).toBe(false);
    expect(RetrySettings.safeParse({ max_attempts: 0 }).success).toBe(false);
  });
});
