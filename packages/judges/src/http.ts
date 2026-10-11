/** The fetch a client calls. Tests pass their own; the default is the global fetch. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchLike;
  /** Abort one attempt after this long. Default 120 seconds. */
  timeoutMs?: number;
  /** Extra attempts after a 408, 409, 429, a 5xx, a 529, a network failure or a timeout. Default 2. */
  maxRetries?: number;
  /** Waits between attempts. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

export type JudgeErrorCode = 'config' | 'http' | 'network' | 'bad_response' | 'cassette_miss';

/** A judge call that gave no answer. The message never holds a key or a header. */
export class JudgeError extends Error {
  readonly code: JudgeErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: JudgeErrorCode, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'JudgeError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_WAIT_MS = 30_000;

/**
 * Posts one JSON body and returns the parsed JSON answer. Retries what may pass later, never a 4xx the
 * request caused. The headers, which carry the key, never reach an error message: errors name the URL
 * and the status, and quote at most 200 characters of the provider's error body.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const text = JSON.stringify(body);

  for (let attempt = 0; ; attempt += 1) {
    let failure: JudgeError;
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: text,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      const payload = parseJson(raw);
      if (response.ok) {
        if (payload === undefined) {
          throw new JudgeError(
            'bad_response',
            `${url} answered ${response.status} with a body that is not JSON`,
          );
        }
        return payload;
      }
      const said = clip(scrub(errorText(payload, raw), headers));
      failure = new JudgeError('http', `${url} answered ${response.status}: ${said}`, {
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
      });
    } catch (cause) {
      if (cause instanceof JudgeError) throw cause;
      const why = cause instanceof Error ? cause.name : 'error';
      failure = new JudgeError('network', `${url} could not be reached (${why})`, { retryable: true });
    }
    if (!failure.retryable || attempt >= maxRetries) throw failure;
    await sleep(Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt));
  }
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** A short sentence from a provider's error body. */
function errorText(payload: unknown, raw: string): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
    if (typeof error === 'string') return error;
    if (typeof payload.message === 'string') return payload.message;
  }
  return raw.trim() === '' ? 'no body' : raw;
}

/** Removes every header value (a key, a bearer token) a provider may echo back in its error body. */
function scrub(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(headers)) {
    for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
      if (secret.length >= 8) out = out.split(secret).join('[redacted]');
    }
  }
  return out;
}

function clip(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a required variable. The error names the variable, never a value. */
export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new JudgeError('config', `${name} is not set`);
  return value;
}
