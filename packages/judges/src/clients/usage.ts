import { isRecord } from '../http';

/** The tokens one provider call used. A field the answer does not carry is left out. */
export type TokenUsage = { readonly input?: number; readonly output?: number };

export type UsageProvider = 'openai' | 'anthropic' | 'google';

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Reads the input and output tokens of an OpenAI, Anthropic or Google answer body. A body that carries no usage
 * gives an empty object, never a guess.
 */
export function usageFromResponse(provider: UsageProvider, body: unknown): TokenUsage {
  if (!isRecord(body)) return {};
  const pair = (source: unknown, input: string, output: string): TokenUsage => {
    if (!isRecord(source)) return {};
    const inTokens = count(source[input]);
    const outTokens = count(source[output]);
    return {
      ...(inTokens === undefined ? {} : { input: inTokens }),
      ...(outTokens === undefined ? {} : { output: outTokens }),
    };
  };
  if (provider === 'openai') return pair(body.usage, 'prompt_tokens', 'completion_tokens');
  if (provider === 'anthropic') return pair(body.usage, 'input_tokens', 'output_tokens');
  return pair(body.usageMetadata, 'promptTokenCount', 'candidatesTokenCount');
}
