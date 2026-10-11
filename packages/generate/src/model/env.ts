import { createAnthropicPort } from './anthropic';
import type { HttpOptions } from './http';
import { createOpenAiPort } from './openai';
import { ModelError, type ModelPort } from './port';

export const PROVIDERS = ['anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * The port the environment configures. With `provider`, that client; without it, Anthropic when
 * ANTHROPIC_API_KEY is set, else the OpenAI-compatible client when OPENAI_API_KEY is set. Throws a
 * ModelError with the code `config` when no key is set or the provider is unknown.
 */
export function portFromEnv(
  options: HttpOptions & { env?: Record<string, string | undefined>; provider?: string } = {},
): ModelPort {
  const env = options.env ?? process.env;
  const provider = options.provider ?? defaultProvider(env);
  if (provider === 'anthropic') return createAnthropicPort({ ...options, env });
  if (provider === 'openai') return createOpenAiPort({ ...options, env });
  if (provider === undefined) {
    throw new ModelError(
      'config',
      'no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL',
    );
  }
  throw new ModelError('config', `unknown provider "${provider}": use ${PROVIDERS.join(' or ')}`);
}

function defaultProvider(env: Record<string, string | undefined>): Provider | undefined {
  if (env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  if (env.OPENAI_API_KEY?.trim()) return 'openai';
  return undefined;
}
