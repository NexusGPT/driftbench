import {
  type HttpAdapterOptions,
  httpAdapter,
  type LitellmAdapterOptions,
  litellmAdapter,
  nexusAdapter,
  type OpenAIChatClientLike,
} from '@agent-nexus/driftbench-adapters';
import type { AgentAdapter, TargetRef } from '@agent-nexus/driftbench-core';

/**
 * The targets the command line reaches from settings alone, with no code: an agent behind a URL (`http`),
 * a model behind a LiteLLM proxy or any OpenAI-compatible endpoint (`litellm`), and an agent on the Nexus
 * platform (`nexus`). The settings are the spec's `target.options`, in snake case; where a spec gives none,
 * as with `--target http:my-bot`, the environment gives the address. A key is never written in a spec: an
 * option names the environment variable that holds it.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** What a built-in target resolves to: its adapter, or the setting that is missing, in one sentence. */
export type BuiltinTarget = { adapter: AgentAdapter } | { missing: string };

/** The adapter names this file serves. */
export const BUILTIN_TARGETS = ['http', 'litellm', 'nexus'] as const;

/** The sentence the no-adapter message adds about these targets. */
export const BUILTIN_TARGETS_NOTE =
  'It also reaches http, litellm and nexus targets from the target.options of a spec.';

/** The built-in target of a `TargetRef`, or undefined when its adapter is not one of the three. */
export function builtinTarget(target: TargetRef, env: Env = process.env): BuiltinTarget | undefined {
  if (target.adapter === 'http') return httpTarget(target, env);
  if (target.adapter === 'litellm') return litellmTarget(target, env);
  if (target.adapter === 'nexus') return nexusTarget(target, env);
  return undefined;
}

/** Why a built-in target cannot run, as one sentence; undefined when it can, or when it is not built in. */
export function builtinTargetHint(target: TargetRef, env: Env = process.env): string | undefined {
  const resolved = builtinTarget(target, env);
  return resolved !== undefined && 'missing' in resolved ? resolved.missing : undefined;
}

function httpTarget(target: TargetRef, env: Env): BuiltinTarget {
  const options = target.options ?? {};
  const url = text(options.url) ?? text(env.DRIFTBENCH_HTTP_URL);
  if (url === undefined) {
    return {
      missing: 'An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL.',
    };
  }
  const headers = headersOf(options.headers, options.headers_env, env);
  if (typeof headers === 'string') return { missing: headers };
  const settings: HttpAdapterOptions = {
    url,
    fetch: guardedFetch(options.redirects === 'same-origin' ? 'same-origin' : 'refuse'),
  };
  if (Object.keys(headers.all).length > 0) settings.headers = headers.all;
  const endStateUrl = text(options.end_state_url);
  if (endStateUrl !== undefined) settings.endStateUrl = endStateUrl;
  const closeUrl = text(options.close_url);
  if (closeUrl !== undefined) settings.closeUrl = closeUrl;
  const timeoutMs = positive(options.timeout_ms);
  if (timeoutMs !== undefined) settings.timeoutMs = timeoutMs;
  const maxToolRounds = positive(options.max_tool_rounds);
  if (maxToolRounds !== undefined) settings.maxToolRounds = maxToolRounds;
  const capabilities = flags(options, ['variants', 'tool_stubs', 'deterministic']);
  if (Object.keys(capabilities).length > 0) {
    settings.capabilities = {
      ...(capabilities.variants === undefined ? {} : { variants: capabilities.variants }),
      ...(capabilities.tool_stubs === undefined ? {} : { toolStubs: capabilities.tool_stubs }),
      ...(capabilities.deterministic === undefined ? {} : { deterministic: capabilities.deterministic }),
    };
  }
  return { adapter: withoutSecrets(httpAdapter(settings), headers.secret) };
}

function litellmTarget(target: TargetRef, env: Env): BuiltinTarget {
  const options = target.options ?? {};
  const baseUrl = text(options.base_url) ?? text(env.LITELLM_BASE_URL) ?? text(env.OPENAI_BASE_URL);
  if (baseUrl === undefined) {
    return {
      missing:
        'A litellm target needs the endpoint: set target.options.base_url in the spec, or LITELLM_BASE_URL.',
    };
  }
  const model = text(options.model) ?? target.agent;
  if (model === undefined) {
    return {
      missing: 'A litellm target needs a model: write it as litellm:<model>, or set target.options.model.',
    };
  }
  const keyName = text(options.api_key_env);
  const key =
    keyName === undefined ? (text(env.LITELLM_API_KEY) ?? text(env.OPENAI_API_KEY)) : text(env[keyName]);
  if (keyName !== undefined && key === undefined) {
    return { missing: `A litellm target reads its key from ${keyName}, which is not set.` };
  }
  const settings: LitellmAdapterOptions = {
    client: chatClient(baseUrl, key, positive(options.timeout_ms)),
    model,
  };
  const system = target.prompt?.text ?? text(options.system);
  if (system !== undefined) settings.system = system;
  const maxTokens = positive(options.max_tokens);
  if (maxTokens !== undefined) settings.maxTokens = maxTokens;
  const maxSteps = positive(options.max_steps);
  if (maxSteps !== undefined) settings.maxSteps = maxSteps;
  if (options.deterministic === true) settings.deterministic = true;
  return { adapter: withoutSecrets(litellmAdapter(settings), [key]) };
}

function nexusTarget(target: TargetRef, env: Env): BuiltinTarget {
  if (target.agent === undefined || target.deployment === undefined) {
    return {
      missing:
        'A nexus target needs the agent id and target.deployment, a deployment id of that agent, in the spec.',
    };
  }
  if (text(env.NEXUS_API_KEY) === undefined) {
    return { missing: 'A nexus target reads its key from NEXUS_API_KEY, which is not set.' };
  }
  const options = target.options ?? {};
  const timeoutMs = positive(options.timeout_ms);
  const generateTimeoutMs = positive(options.generate_timeout_ms);
  return {
    adapter: withoutSecrets(
      nexusAdapter({
        env,
        fetch: guardedFetch('refuse'),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(generateTimeoutMs === undefined ? {} : { generateTimeoutMs }),
        ...(options.keep_conversations === true ? { keepConversations: true } : {}),
      }),
      [env.NEXUS_API_KEY],
    ),
  };
}

/**
 * A chat completions client on `fetch`: one POST to `<base>/chat/completions`. A failing status is thrown
 * with its `status` and `headers`, where the shared retry policy reads them.
 */
function chatClient(baseUrl: string, key: string | undefined, timeoutMs = 120_000): OpenAIChatClientLike {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const guarded = guardedFetch('refuse');
  return {
    chat: {
      completions: {
        async create(body) {
          const response = await guarded(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const raw = await response.text();
          if (!response.ok) {
            const said = raw.replace(/\s+/g, ' ').trim().slice(0, 200);
            throw Object.assign(new Error(`${url} answered ${response.status}: ${said}`), {
              status: response.status,
              headers: response.headers,
            });
          }
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            throw new Error(`${url} answered ${response.status} with a body that is not JSON`);
          }
        },
      },
    },
  };
}

/**
 * `headers` as written, plus one header per `headers_env` entry, its value read from the environment. The
 * values read from the environment are secrets: the adapter never lets them into an error or a result.
 */
function headersOf(
  literal: unknown,
  fromEnv: unknown,
  env: Env,
): { all: Record<string, string>; secret: string[] } | string {
  const all: Record<string, string> = {};
  const secret: string[] = [];
  if (isRecord(literal)) {
    for (const [name, value] of Object.entries(literal)) {
      if (typeof value !== 'string') return `An http target's header ${name} must be a string.`;
      all[name] = value;
    }
  }
  if (isRecord(fromEnv)) {
    for (const [name, variable] of Object.entries(fromEnv)) {
      const value = typeof variable === 'string' ? text(env[variable]) : undefined;
      if (value === undefined) {
        return `An http target reads the header ${name} from ${String(variable)}, which is not set.`;
      }
      all[name] = value;
      secret.push(value);
    }
  }
  return { all, secret };
}

const REDACTED = '[redacted]';
const NOT_SHOWN = 'the response body of an authentication failure is not shown';

/**
 * The fetch of a built-in target. It never follows a redirect by itself: a redirect to another origin is
 * always refused, so neither the request nor a key header reaches a host the spec did not name; a 307 or
 * 308 on the same origin is followed only when the target says `redirects: same-origin`. A refused redirect
 * comes back as the response it was, with the reason as its body. The body of a 401 or a 403 is replaced
 * too: an endpoint may repeat the credential it was sent.
 */
function guardedFetch(redirects: 'refuse' | 'same-origin') {
  const answer = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const origin = new URL(input).origin;
    let url = input;
    for (let hop = 0; ; hop++) {
      const response = await fetch(url, { ...init, redirect: 'manual' });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && response.status !== 304 && location !== null) {
        await response.body?.cancel();
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return answer(
            response.status,
            'the endpoint redirects to an address that is not a URL; redirects are refused',
          );
        }
        if (next.origin !== origin) {
          return answer(
            response.status,
            `the endpoint redirects to another origin (${next.origin}), which is refused: give the final URL in the target`,
          );
        }
        const followable =
          redirects === 'same-origin' && (response.status === 307 || response.status === 308);
        if (!followable || hop >= 5) {
          return answer(
            response.status,
            `the endpoint redirects to ${next.pathname}; redirects are refused: give the final URL, or set target.options.redirects: same-origin to follow a 307 or a 308 on the same origin`,
          );
        }
        url = next.href;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return answer(response.status, NOT_SHOWN);
      }
      return response;
    }
  };
}

/** Replaces every secret in a text. Longest first, so a secret that contains another goes whole. */
function scrubber(secrets: readonly (string | undefined)[]): (value: string) => string {
  const known = [
    ...new Set(secrets.filter((secret): secret is string => secret !== undefined && secret.length >= 4)),
  ];
  known.sort((a, b) => b.length - a.length);
  return (value) => known.reduce((out, secret) => out.split(secret).join(REDACTED), value);
}

/** An error with the secrets taken out of its message, its stack and its causes; the same object, same class. */
function scrubError(cause: unknown, scrub: (value: string) => string, depth = 0): unknown {
  if (!(cause instanceof Error) || depth > 5) return typeof cause === 'string' ? scrub(cause) : cause;
  cause.message = scrub(cause.message);
  if (typeof cause.stack === 'string') cause.stack = scrub(cause.stack);
  if (cause.cause !== undefined) cause.cause = scrubError(cause.cause, scrub, depth + 1);
  return cause;
}

/** A JSON-like value with the secrets taken out of every string in it. */
function scrubValue<T>(value: T, scrub: (text: string) => string): T {
  if (typeof value === 'string') return scrub(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, scrub)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubValue(item, scrub)]),
    ) as T;
  }
  return value;
}

/**
 * The adapter with the secrets it holds kept out of everything that leaves it: an error it throws, and a
 * turn or an end state it returns (an agent can repeat a header it received). What is stored and printed
 * comes from these, so a secret never reaches a result file, a store or the terminal.
 */
function withoutSecrets(adapter: AgentAdapter, secrets: readonly (string | undefined)[]): AgentAdapter {
  const scrub = scrubber(secrets);
  const kept = async <T>(work: () => Promise<T>, clean: boolean): Promise<T> => {
    try {
      const value = await work();
      return clean ? scrubValue(value, scrub) : value;
    } catch (cause) {
      throw scrubError(cause, scrub);
    }
  };
  const { trace, endState, readArtifact } = adapter;
  return {
    id: adapter.id,
    version: adapter.version,
    capabilities: () => adapter.capabilities(),
    open: (given) => kept(() => adapter.open(given), false),
    send: (session, turn) => kept(() => adapter.send(session, turn), true),
    close: (session) => kept(() => adapter.close(session), false),
    ...(trace ? { trace: (session, turn) => kept(() => trace.call(adapter, session, turn), true) } : {}),
    ...(endState
      ? { endState: (session, source) => kept(() => endState.call(adapter, session, source), true) }
      : {}),
    ...(readArtifact
      ? { readArtifact: (session, path) => kept(() => readArtifact.call(adapter, session, path), false) }
      : {}),
  };
}

function flags<K extends string>(
  options: Record<string, unknown>,
  names: readonly K[],
): Partial<Record<K, boolean>> {
  const out: Partial<Record<K, boolean>> = {};
  for (const name of names) if (typeof options[name] === 'boolean') out[name] = options[name];
  return out;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
