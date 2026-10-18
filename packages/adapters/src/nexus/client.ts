import {
  AdapterTransportError,
  AgentFailure,
  isPlainObject,
  retryableStatus,
} from '@agent-nexus/driftbench-core';
import { excerpt, type FetchLike, type HttpReply, sendRequest } from '../shared';

/**
 * A small client for the Nexus public API v1: every path is relative to `<base>/api/public/v1`, the key
 * travels in the `api-key` header, and an answer `{ success: true, data, meta }` is unwrapped to its data.
 *
 * Errors: no connection, a timeout, a 429 or a 5xx is an AdapterTransportError, which the runner retries under
 * the shared policy, honouring Retry-After; any other failing status is an AgentFailure carrying the platform's
 * error code and message.
 * Messages name the method and the path, never a header, so the key reaches no message and no log.
 */

export const DEFAULT_BASE_URL = 'https://api.nexusgpt.io';

export type Query = Record<string, string | number | undefined>;

export type Answer = { data: unknown; meta?: Record<string, unknown> };

export type NexusClient = {
  get(path: string, query?: Query): Promise<Answer>;
  post(path: string, body?: unknown, timeoutMs?: number): Promise<Answer>;
  /** Deletes; a 404 counts as already gone. */
  delete(path: string): Promise<void>;
};

export function createClient(options: {
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
  timeoutMs: number;
}): NexusClient {
  const root = `${options.baseUrl.replace(/\/+$/, '')}/api/public/v1`;

  async function call(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
    timeoutMs?: number,
  ): Promise<{ reply: HttpReply; label: string }> {
    const url = new URL(`${root}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const label = `${method} ${path}`;
    const headers: Record<string, string> = { 'api-key': options.apiKey, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const reply = await sendRequest(
      options.fetch,
      url.toString(),
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      timeoutMs ?? options.timeoutMs,
      label,
    );
    return { reply, label };
  }

  return {
    async get(path, query) {
      const { reply, label } = await call('GET', path, undefined, query);
      return unwrap(reply, label);
    },
    async post(path, body, timeoutMs) {
      const { reply, label } = await call('POST', path, body, undefined, timeoutMs);
      return unwrap(reply, label);
    },
    async delete(path) {
      const { reply, label } = await call('DELETE', path);
      if (reply.status === 404) return;
      unwrap(reply, label);
    },
  };
}

function unwrap(reply: HttpReply, label: string): Answer {
  const body = reply.json;
  if (reply.status < 200 || reply.status >= 300) throw failure(reply, label);
  if (isPlainObject(body) && body.success === false) throw failure(reply, label);
  if (isPlainObject(body) && body.success === true && 'data' in body) {
    return isPlainObject(body.meta) ? { data: body.data, meta: body.meta } : { data: body.data };
  }
  if (body !== undefined) return { data: body };
  if (reply.text.trim() === '') return { data: {} };
  throw new AgentFailure(`${label} answered ${reply.status} with a body that is not JSON`);
}

function failure(reply: HttpReply, label: string): AdapterTransportError | AgentFailure {
  const message = `${label} answered ${reply.status}: ${errorDetail(reply.json) ?? excerpt(reply.text)}`;
  if (!retryableStatus(reply.status)) return new AgentFailure(message);
  return new AdapterTransportError(message, {
    status: reply.status,
    ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
  });
}

/** The platform's own words for an error: `error.code: error.message`, or a top-level `message`. */
function errorDetail(body: unknown): string | undefined {
  if (!isPlainObject(body)) return undefined;
  const error = body.error;
  const parts = isPlainObject(error)
    ? [error.code, error.message]
    : [typeof error === 'string' ? error : undefined, body.message];
  const words = parts.filter((part): part is string => typeof part === 'string' && part !== '');
  return words.length > 0 ? words.join(': ') : undefined;
}
