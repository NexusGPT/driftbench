import { describe, expect, it } from 'vitest';
import { createOpenAiPort, familyOf, ModelError } from '../../src/model';
import { fakeFetch, headersOf, json } from './support';

const KEY = 'test-openai-key-000';
const ENV = { OPENAI_API_KEY: KEY, OPENAI_MODEL: 'gpt-5' };
const REQUEST = { system: 'You map an agent.', user: 'SECTION: rules' };

function completion(content: string | null, finishReason = 'stop', refusal: string | null = null) {
  return json({
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finishReason }],
  });
}

async function failure(promise: Promise<unknown>): Promise<ModelError> {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(error instanceof ModelError)) throw new Error(`expected a ModelError, got ${String(error)}`);
  return error;
}

describe('createOpenAiPort', () => {
  it('posts a system and a user message to /chat/completions with a bearer key', async () => {
    const { fetch, calls } = fakeFetch(completion('{"section":"rules"}'));
    const port = createOpenAiPort({ env: ENV, fetch });
    expect(await port.complete(REQUEST)).toBe('{"section":"rules"}');
    expect(port.family).toBe('openai');
    expect(port.model).toBe('gpt-5');
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headersOf(calls[0])).toMatchObject({ authorization: `Bearer ${KEY}` });
    expect(calls[0]?.body).toEqual({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'You map an agent.' },
        { role: 'user', content: 'SECTION: rules' },
      ],
      max_tokens: 16000,
    });
  });

  it('reads OPENAI_BASE_URL for a compatible server and infers the family from the model', async () => {
    const { fetch, calls } = fakeFetch(completion('ok'));
    const port = createOpenAiPort({
      env: {
        ...ENV,
        OPENAI_MODEL: 'meta-llama/Llama-3.3-70B-Instruct',
        OPENAI_BASE_URL: 'http://localhost:8000/v1/',
      },
      fetch,
    });
    await port.complete({ ...REQUEST, maxTokens: 500 });
    expect(calls[0]?.url).toBe('http://localhost:8000/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({ max_tokens: 500 });
    expect(port.family).toBe('meta');
  });

  it('takes OPENAI_FAMILY over the inferred family', () => {
    const port = createOpenAiPort({
      env: { ...ENV, OPENAI_MODEL: 'house-model-7', OPENAI_FAMILY: 'acme-lab' },
    });
    expect(port.family).toBe('acme-lab');
  });

  it('switches to max_completion_tokens when the server asks for it, and keeps it', async () => {
    const { fetch, calls } = fakeFetch(
      json(
        {
          error: {
            type: 'invalid_request_error',
            message:
              "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          },
        },
        400,
      ),
      completion('first'),
      completion('second'),
    );
    const port = createOpenAiPort({ env: ENV, fetch });
    expect(await port.complete(REQUEST)).toBe('first');
    expect(await port.complete(REQUEST)).toBe('second');
    expect(calls.map((call) => Object.keys(call.body).filter((key) => key.startsWith('max')))).toEqual([
      ['max_tokens'],
      ['max_completion_tokens'],
      ['max_completion_tokens'],
    ]);
  });

  it('turns a cut answer, a refusal and a filtered answer into errors', async () => {
    const cases: Array<[Response, string]> = [
      [completion('{"sec', 'length'), 'truncated'],
      [completion(null, 'stop', 'I cannot help with that.'), 'refusal'],
      [completion('', 'content_filter'), 'refusal'],
      [completion('   '), 'empty'],
      [json({ choices: [] }), 'bad_response'],
    ];
    for (const [response, code] of cases) {
      const { fetch } = fakeFetch(response);
      expect((await failure(createOpenAiPort({ env: ENV, fetch }).complete(REQUEST))).code).toBe(code);
    }
  });

  it('needs a key and a model', () => {
    expect(() => createOpenAiPort({ env: { OPENAI_MODEL: 'gpt-5' } })).toThrowError(
      /OPENAI_API_KEY is not set/,
    );
    expect(() => createOpenAiPort({ env: { OPENAI_API_KEY: KEY } })).toThrowError(/OPENAI_MODEL is not set/);
  });

  it('never shows the key', async () => {
    const { fetch } = fakeFetch(
      json({ error: { type: 'invalid_api_key', message: 'Incorrect API key provided' } }, 401),
    );
    const port = createOpenAiPort({ env: ENV, fetch });
    expect(JSON.stringify(port)).not.toContain(KEY);
    const error = await failure(port.complete(REQUEST));
    expect(error.message).toBe('401 invalid_api_key: Incorrect API key provided');
    expect(`${error.message} ${error.stack}`).not.toContain(KEY);
  });
});

describe('familyOf', () => {
  it('names the family of common model names and reads past a provider prefix', () => {
    expect(familyOf('gpt-4o')).toBe('openai');
    expect(familyOf('o3-mini')).toBe('openai');
    expect(familyOf('openrouter/anthropic/claude-sonnet-5-5')).toBe('anthropic');
    expect(familyOf('gemini-2.5-pro')).toBe('google');
    expect(familyOf('mistral-large-latest')).toBe('mistral');
    expect(familyOf('Qwen/Qwen3-32B')).toBe('qwen');
    expect(familyOf('deepseek-chat')).toBe('deepseek');
  });

  it('says openai for an unknown name on api.openai.com, unknown elsewhere', () => {
    expect(familyOf('ft:custom-1', 'https://api.openai.com/v1')).toBe('openai');
    expect(familyOf('house-model-7', 'http://localhost:8000/v1')).toBe('unknown');
  });
});
