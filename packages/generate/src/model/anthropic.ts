import { errorText, type HttpOptions, isRecord, postJson } from './http';
import { ModelError, type ModelPort, type ModelRequest } from './port';

/** The model used when ANTHROPIC_MODEL is not set. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 16_000;

export type AnthropicOptions = HttpOptions & {
  /** Where the variables are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
};

/**
 * A port on the Anthropic Messages API, called with fetch: POST /v1/messages with the system prompt and one
 * user message. Reads ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (default claude-opus-5-5) and
 * ANTHROPIC_BASE_URL (default https://api.anthropic.com). The key stays in this closure: it is not a field
 * of the port, so printing or serialising the port never shows it.
 */
export function createAnthropicPort(options: AnthropicOptions = {}): ModelPort {
  const env = options.env ?? process.env;
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ModelError('config', 'ANTHROPIC_API_KEY is not set');
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const base = (env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = `${base}/v1/messages`;

  return {
    family: 'anthropic',
    model,
    async complete(request: ModelRequest): Promise<string> {
      const payload = await postJson(
        url,
        { 'x-api-key': key, 'anthropic-version': API_VERSION },
        {
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        },
        errorText,
        options,
      );
      return readAnswer(payload, model);
    },
  };
}

/** The text blocks of a Messages API answer, joined. Thinking and other blocks are not part of the answer. */
function readAnswer(payload: unknown, model: string): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    throw new ModelError('bad_response', `${model} answered without a content list`);
  }
  const stop = payload.stop_reason;
  if (stop === 'refusal')
    throw new ModelError('refusal', `${model} declined the request (stop_reason refusal)`);
  if (stop === 'max_tokens') {
    throw new ModelError('truncated', `${model} stopped at max_tokens: the answer is cut`);
  }
  const text = payload.content
    .filter((block): block is { type: 'text'; text: string } => {
      return isRecord(block) && block.type === 'text' && typeof block.text === 'string';
    })
    .map((block) => block.text)
    .join('');
  if (text.trim() === '') throw new ModelError('empty', `${model} answered with no text`);
  return text;
}
