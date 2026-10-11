import { ModelError } from './port';

/** The fetch a client calls. Tests pass their own; the default is the global fetch. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchLike;
  /** Abort one attempt after this long. Default 10 minutes, the Anthropic SDKs' default. */
  timeoutMs?: number;
  /** Extra attempts after a 429, a 5xx, a 529, a network failure or a timeout. Default 2. */
  maxRetries?: number;
  /** Waits between attempts. Tests pass a stub that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_WAIT_MS = 60_000;

/**
 * Posts one JSON body and returns the parsed JSON answer. Retries what may pass later, never a 4xx the
 * request itself caused. `describeError` turns a provider's error body into a sentence. The headers, which
 * carry the key, never reach an error message.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  describeError: (status: number, payload: unknown) => string,
  options: HttpOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 600_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const text = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    let failure: ModelError;
    let waitMs = 1000 * 2 ** attempt;
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: text,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await readPayload(response);
      if (response.ok) {
        if (payload === undefined) {
          throw new ModelError(
            'bad_response',
            `${url} answered ${response.status} with a body that is not JSON`,
          );
        }
        return payload;
      }
      failure = new ModelError('http', describeError(response.status, payload), {
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
      });
      waitMs = retryAfter(response) ?? waitMs;
    } catch (cause) {
      if (cause instanceof ModelError) throw cause;
      failure = transportError(cause, url);
    }
    if (!failure.retryable || attempt >= maxRetries) throw failure;
    await sleep(Math.min(waitMs, MAX_WAIT_MS));
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '');
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function transportError(cause: unknown, url: string): ModelError {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ModelError('timeout', `${url} did not answer in time`, { retryable: true });
  }
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new ModelError('network', `cannot reach ${url}: ${reason}`, { retryable: true });
}

/** Reads `error.type` and `error.message` from a provider's error body, the shape both providers use. */
export function errorText(status: number, payload: unknown): string {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const type = typeof error?.type === 'string' ? error.type : undefined;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  if (type && message) return `${status} ${type}: ${message}`;
  if (message) return `${status}: ${message}`;
  return `${status}: the provider gave no error message`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
