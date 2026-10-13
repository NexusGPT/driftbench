import {
  type HttpAdapterOptions,
  httpAdapter,
  type LitellmAdapterOptions,
  litellmAdapter,
  nexusAdapter,
  type OpenAIChatClientLike,
} from '@agent-nexus/driftbench-adapters';
import type { AgentAdapter, TargetRef } from '@agent-nexus/driftbench-core';
import { guardedFetch, secretForms, withoutSecrets } from './target-security';

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
  if (BUILTIN_TARGETS.some((name) => name === target.adapter)) {
    const unsafe = unsafeStoredSettings(target, env);
    if (unsafe) return { missing: unsafe };
  }
  if (target.adapter === 'http') return httpTarget(target, env);
  if (target.adapter === 'litellm') return litellmTarget(target, env);
  if (target.adapter === 'nexus') return nexusTarget(target, env);
  return undefined;
}

/** Specs and target options are persisted verbatim: refuse credential-bearing configuration before storage. */
function unsafeStoredSettings(target: TargetRef, env: Env): string | undefined {
  const options = target.options ?? {};
  const refusal =
    'Credentials cannot be stored in target options: use headers_env or api_key_env for keys, and the URL environment variable for a credential-bearing URL.';
  if (
    isRecord(options.headers) &&
    Object.keys(options.headers).some((name) => /authorization|cookie|api[-_]?key|token|secret/i.test(name))
  )
    return refusal;
  for (const name of ['url', 'base_url', 'end_state_url', 'close_url']) {
    if (typeof options[name] !== 'string') continue;
    try {
      const url = new URL(options[name]);
      if (
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) =>
          /authorization|password|api[-_]?key|token|secret|^key$|signature/i.test(key),
        )
      )
        return refusal;
    } catch {
      /* The adapter reports malformed URLs without echoing them. */
    }
  }
  const keyName = text(options.api_key_env);
  const secrets =
    target.adapter === 'nexus'
      ? [env.NEXUS_API_KEY]
      : target.adapter === 'litellm'
        ? [keyName === undefined ? (env.LITELLM_API_KEY ?? env.OPENAI_API_KEY) : env[keyName]]
        : isRecord(options.headers_env)
          ? Object.values(options.headers_env).flatMap((name) =>
              typeof name === 'string' ? [env[name]] : [],
            )
          : [];
  const serialized = JSON.stringify({
    urls: ['url', 'base_url', 'end_state_url', 'close_url'].map((name) => options[name]),
    headers: isRecord(options.headers) ? Object.values(options.headers) : [],
  });
  if (secretForms(secrets).some((secret) => secret.length >= 4 && serialized.includes(secret)))
    return refusal;
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
    fetch: guardedFetch(
      options.redirects === 'same-origin' ? 'same-origin' : 'refuse',
      options.debug_error_body === true,
      text(options.end_state_url),
    ),
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
  return { adapter: withoutSecrets(httpAdapter(settings), headers.secret, url) };
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
    client: chatClient(baseUrl, key, positive(options.timeout_ms), options.debug_error_body === true),
    model,
  };
  const system = target.prompt?.text ?? text(options.system);
  if (system !== undefined) settings.system = system;
  const maxTokens = positive(options.max_tokens);
  if (maxTokens !== undefined) settings.maxTokens = maxTokens;
  const maxSteps = positive(options.max_steps);
  if (maxSteps !== undefined) settings.maxSteps = maxSteps;
  if (options.deterministic === true) settings.deterministic = true;
  return { adapter: withoutSecrets(litellmAdapter(settings), [key], baseUrl) };
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
        fetch: guardedFetch('refuse', options.debug_error_body === true),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(generateTimeoutMs === undefined ? {} : { generateTimeoutMs }),
        ...(options.keep_conversations === true ? { keepConversations: true } : {}),
      }),
      [env.NEXUS_API_KEY],
      env.NEXUS_BASE_URL ?? 'https://api.nexusgpt.io',
    ),
  };
}

/**
 * A chat completions client on `fetch`: one POST to `<base>/chat/completions`. A failing status is thrown
 * with a fixed diagnostic and its numeric retry settings; upstream bodies and headers stay private.
 */
function chatClient(
  baseUrl: string,
  key: string | undefined,
  timeoutMs = 120_000,
  debug = false,
): OpenAIChatClientLike {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const guarded = guardedFetch('refuse', debug);
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
