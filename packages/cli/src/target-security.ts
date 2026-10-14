import {
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  type Observed,
  parseRetryAfter,
  retryableStatus,
} from '@agent-nexus/driftbench-core';

const REDACTED = '[redacted]';

/** Only fields constructed here may leave a failed request. No upstream headers or causes survive. */
class TargetError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(host: string, detail: string, status?: number, bytes?: number, retryAfterMs?: number) {
    super(
      `${host} ${status === undefined ? 'transport failed' : `answered ${status}`}: ${detail}; body length ${bytes ?? 'unknown'}`,
    );
    this.status = status;
    this.retryable = status === undefined || retryableStatus(status);
    this.retryAfterMs = retryAfterMs;
  }
}

function hostOf(input: string): string {
  try {
    return new URL(input).host;
  } catch {
    return 'target';
  }
}

/** Manual redirects, fixed failure messages, and an explicit unsafe escape hatch for error bodies. */
export function guardedFetch(redirects: 'refuse' | 'same-origin', debug = false, notFoundUrl?: string) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const host = hostOf(input);
    let origin: string;
    try {
      origin = new URL(input).origin;
    } catch {
      throw new TargetError(host, 'invalid target URL');
    }
    let url = input;
    for (let hop = 0; ; hop++) {
      let response: Response;
      let raw: string;
      try {
        response = await fetch(url, { ...init, redirect: 'manual' });
        // Consume here so a broken response stream cannot leak its thrown error through an adapter.
        raw = await response.text();
      } catch {
        throw new TargetError(host, 'request or response transport failed');
      }
      const bytes = Buffer.byteLength(raw);
      const fail = (detail: string): never => {
        const retryAfter = response.headers.get('retry-after-ms');
        const retryAfterMs =
          retryAfter !== null && /^\d+(\.\d+)?$/.test(retryAfter)
            ? Math.round(Number(retryAfter))
            : parseRetryAfter(response.headers.get('retry-after'));
        throw new TargetError(
          host,
          `${detail}${debug ? `; unsafe debug body: ${raw}` : ''}`,
          response.status,
          bytes,
          retryAfterMs,
        );
      };
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return fail('invalid redirect; redirects are refused');
        }
        if (next.origin !== origin || next.username !== '' || next.password !== '') {
          return fail('redirects to another origin or credentials are refused');
        }
        if (redirects !== 'same-origin' || ![307, 308].includes(response.status) || hop >= 5) {
          return fail('redirects are refused');
        }
        url = next.href;
        continue;
      }
      if (!response.ok) {
        // The adapters treat an already deleted conversation or an absent end state as empty.
        if (response.status === 404 && (init?.method === 'DELETE' || input === notFoundUrl)) {
          return new Response(null, { status: 404 });
        }
        return fail('target request failed; upstream body and headers are not shown');
      }
      // Do not pass upstream headers to code which could serialize them with request metadata.
      return new Response([204, 205].includes(response.status) ? null : raw, { status: response.status });
    }
  };
}

/** Literal credentials and common reversible spellings, including encoded Bearer values. Best effort. */
export function secretForms(secrets: readonly (string | undefined)[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    const bare = secret.replace(/^Bearer\s+/i, '');
    for (const value of new Set([secret, bare, `Bearer ${bare}`])) {
      forms.add(value);
      for (const once of encodedForms(value)) {
        forms.add(once);
        for (const twice of encodedForms(once)) forms.add(twice);
      }
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Every supported spelling of the four encodings, used at each level of composition. */
function encodedForms(value: string): string[] {
  const percent = encodeURIComponent(value);
  const base64 = Buffer.from(value).toString('base64');
  const hex = Buffer.from(value).toString('hex');
  return [
    percent,
    percent.replace(/%[A-F\d]{2}/g, (part) => part.toLowerCase()),
    base64,
    base64.replace(/=+$/, ''),
    base64.replace(/\+/g, '-').replace(/\//g, '_'),
    Buffer.from(value).toString('base64url'),
    hex,
    hex.toUpperCase(),
  ];
}

/** Strip request metadata, but preserve and scrub agent content, including object keys and tool payloads. */
function cleanValue<T>(value: T, scrub: (text: string) => string): T {
  if (typeof value === 'string') return scrub(value) as T;
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, scrub)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/^(headers|requestHeaders|responseHeaders)$/i.test(key)) return [key, REDACTED];
        if (/^(url|uri|requestUrl)$/i.test(key) && typeof item === 'string') {
          try {
            const url = new URL(item);
            url.username = '';
            url.password = '';
            url.search = '';
            url.hash = '';
            return [key, scrub(url.href)];
          } catch {
            return [key, REDACTED];
          }
        }
        return [scrub(key), cleanValue(item, scrub)];
      }),
    ) as T;
  }
  return value;
}

function safeError(cause: unknown, host: string): Error {
  const seen = new Set<unknown>();
  let current = cause;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof TargetError) {
      return current.retryable
        ? new AdapterTransportError(current.message, {
            status: current.status,
            retryAfterMs: current.retryAfterMs,
            ...(cause instanceof AdapterTransportError
              ? { exhausted: cause.exhausted, attempts: cause.attempts }
              : {}),
          })
        : new AgentFailure(current.message);
    }
    current = current.cause;
  }
  // Parsing and adapter errors can contain arbitrary upstream content too. Never forward their text.
  return cause instanceof AdapterTransportError
    ? new AdapterTransportError(`${host} transport failed; body length unknown`, {
        exhausted: cause.exhausted,
        attempts: cause.attempts,
      })
    : new AgentFailure(`${host} target response failed; body length unknown`);
}

/** Sanitize before the runner, checks, output, SQLite or cache can see the returned record. */
export function withoutSecrets(
  adapter: AgentAdapter,
  secrets: readonly (string | undefined)[],
  url: string,
): AgentAdapter {
  const forms = secretForms(secrets);
  const clean = <T>(value: T): { value: T; redactions: number } => {
    let redactions = 0;
    const scrub = (text: string) =>
      forms.reduce((out, secret) => {
        const parts = out.split(secret);
        redactions += parts.length - 1;
        return parts.join(REDACTED);
      }, text);
    return { value: cleanValue(value, scrub), redactions };
  };
  const kept = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (cause) {
      throw safeError(cause, hostOf(url));
    }
  };
  const observed = async (work: () => Promise<Observed>): Promise<Observed> => {
    const result = clean(await kept(work));
    const raw = result.value.raw;
    return {
      ...result.value,
      raw: {
        ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw)
          ? raw
          : raw === undefined
            ? {}
            : { value: raw }),
        redactions: result.redactions,
      },
    };
  };
  const { trace, endState, readArtifact } = adapter;
  return {
    id: adapter.id,
    version: `${adapter.version}+safe-target-v3`,
    capabilities: () => adapter.capabilities(),
    open: (given) => kept(() => adapter.open(given)),
    send: (session, turn) => observed(() => adapter.send(session, turn)),
    close: (session) => kept(() => adapter.close(session)),
    ...(trace ? { trace: (session, turn) => observed(() => trace.call(adapter, session, turn)) } : {}),
    ...(endState
      ? {
          endState: async (session, source) =>
            clean(await kept(() => endState.call(adapter, session, source))).value,
        }
      : {}),
    ...(readArtifact
      ? {
          readArtifact: async (session, path) => {
            const bytes = await kept(() => readArtifact.call(adapter, session, path));
            return Buffer.from(clean(Buffer.from(bytes).toString('utf8')).value);
          },
        }
      : {}),
  };
}
