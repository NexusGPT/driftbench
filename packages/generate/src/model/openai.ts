import { errorText, type HttpOptions, isRecord, postJson } from './http';
import { ModelError, type ModelPort, type ModelRequest } from './port';

const DEFAULT_MAX_TOKENS = 16_000;

export type OpenAiOptions = HttpOptions & {
  /** Where the variables are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
};

/**
 * A port on an OpenAI-compatible chat completions API, called with fetch: POST <base>/chat/completions with
 * a system and a user message. Reads OPENAI_API_KEY (required), OPENAI_MODEL (required: compatible servers
 * share no default), OPENAI_BASE_URL (default https://api.openai.com/v1) and OPENAI_FAMILY (optional). A
 * compatible server can host any family, so the family comes from OPENAI_FAMILY, else from the model name,
 * else `unknown`. The key stays in this closure, never on the port.
 */
export function createOpenAiPort(options: OpenAiOptions = {}): ModelPort {
  const env = options.env ?? process.env;
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new ModelError('config', 'OPENAI_API_KEY is not set');
  const model = env.OPENAI_MODEL?.trim();
  if (!model) throw new ModelError('config', 'OPENAI_MODEL is not set: name the model the server should run');
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const family = env.OPENAI_FAMILY?.trim() || familyOf(model, base);
  const headers = { authorization: `Bearer ${key}` };
  // Recent OpenAI models refuse max_tokens and want max_completion_tokens; most compatible servers want
  // max_tokens. The first refusal switches this port to the other field.
  let tokenField: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';

  return {
    family,
    model,
    async complete(request: ModelRequest): Promise<string> {
      const body = (field: string) => ({
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        [field]: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      let payload: unknown;
      try {
        payload = await postJson(url, headers, body(tokenField), errorText, options);
      } catch (cause) {
        if (!(cause instanceof ModelError) || cause.status !== 400 || tokenField !== 'max_tokens')
          throw cause;
        if (!cause.message.includes('max_completion_tokens')) throw cause;
        tokenField = 'max_completion_tokens';
        payload = await postJson(url, headers, body(tokenField), errorText, options);
      }
      return readAnswer(payload, model);
    },
  };
}

function readAnswer(payload: unknown, model: string): string {
  const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new ModelError('bad_response', `${model} answered without a choice`);
  }
  const { message } = choice;
  if (typeof message.refusal === 'string' && message.refusal.trim() !== '') {
    throw new ModelError('refusal', `${model} declined the request: ${message.refusal}`);
  }
  if (choice.finish_reason === 'content_filter') {
    throw new ModelError('refusal', `${model} declined the request (finish_reason content_filter)`);
  }
  if (choice.finish_reason === 'length') {
    throw new ModelError('truncated', `${model} stopped at the token limit: the answer is cut`);
  }
  const text = typeof message.content === 'string' ? message.content : '';
  if (text.trim() === '') throw new ModelError('empty', `${model} answered with no text`);
  return text;
}

const FAMILIES: Array<[RegExp, string]> = [
  [/^(gpt|o\d|chatgpt|text-|davinci)/, 'openai'],
  [/claude/, 'anthropic'],
  [/gemini|gemma/, 'google'],
  [/llama/, 'meta'],
  [/mistral|mixtral|codestral|ministral/, 'mistral'],
  [/qwen|qwq/, 'qwen'],
  [/deepseek/, 'deepseek'],
  [/grok/, 'xai'],
  [/command|aya/, 'cohere'],
  [/phi-?\d/, 'microsoft'],
];

/**
 * The family of a model by its name, such as `meta` for `llama-3.3-70b`. A provider prefix such as
 * `openrouter/meta-llama/...` is read past. `openai` for any model on api.openai.com, `unknown` otherwise.
 */
export function familyOf(model: string, baseUrl = ''): string {
  const name = model.toLowerCase().split('/').at(-1) ?? '';
  for (const [pattern, family] of FAMILIES) if (pattern.test(name)) return family;
  if (baseUrl.includes('api.openai.com')) return 'openai';
  return 'unknown';
}
