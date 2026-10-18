import { AdapterTransportError, parseRetryAfter } from '@agent-nexus/driftbench-core';
import { describeError } from './observed';

/** The part of `fetch` the adapters use, so a test can hand in its own. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One answered request: its status, its body as text and as JSON when it parses, and how long it took. */
export type HttpReply = {
  readonly status: number;
  readonly text: string;
  readonly json: unknown;
  readonly latencyMs: number;
  /** The wait the server asked for in its `retry-after-ms` or `retry-after` header, when it sent one. */
  readonly retryAfterMs?: number;
};

/**
 * Sends one request. A failure to connect, a timeout or a body that breaks off is an AdapterTransportError;
 * every HTTP status comes back for the caller to judge. `label` names the request in errors; it carries the
 * method and the URL, never a header, so no key reaches a message.
 */
export async function sendRequest(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<HttpReply> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const why = isTimeout(cause) ? `no answer within ${timeoutMs} ms` : describeError(cause);
    throw new AdapterTransportError(`${label} failed: ${why}`, { cause });
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw new AdapterTransportError(`${label}: the response broke off: ${describeError(cause)}`, { cause });
  }
  const retryAfterMs = retryAfterOf(response.headers);
  return {
    status: response.status,
    text,
    json: parseJson(text),
    latencyMs: Math.round(performance.now() - started),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** The first characters of a body, for an error message. */
export function excerpt(text: string, size = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > size ? `${flat.slice(0, size)}...` : flat;
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isTimeout(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

function retryAfterOf(headers: Headers | undefined): number | undefined {
  const ms = headers?.get('retry-after-ms');
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  return parseRetryAfter(headers?.get('retry-after'));
}
