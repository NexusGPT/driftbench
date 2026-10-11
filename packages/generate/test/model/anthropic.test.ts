import { describe, expect, it } from 'vitest';
import { createAnthropicPort, DEFAULT_ANTHROPIC_MODEL, ModelError } from '../../src/model';
import { fakeFetch, headersOf, json, recordSleep } from './support';

/** A made-up key: the tests check it never leaves the request header. */
const KEY = 'test-anthropic-key-000';
const ENV = { ANTHROPIC_API_KEY: KEY };
const REQUEST = { system: 'You map an agent.', user: 'SECTION: stages' };

function message(content: unknown[], stopReason = 'end_turn') {
  return json({
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    content,
    stop_reason: stopReason,
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

describe('createAnthropicPort', () => {
  it('posts the system prompt and one user message to /v1/messages with the version header', async () => {
    const { fetch, calls } = fakeFetch(message([{ type: 'text', text: '{"section":"stages"}' }]));
    const port = createAnthropicPort({ env: ENV, fetch });
    expect(await port.complete(REQUEST)).toBe('{"section":"stages"}');
    expect(port.family).toBe('anthropic');
    expect(port.model).toBe('claude-opus-5-5');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.init.method).toBe('POST');
    expect(headersOf(calls[0])).toMatchObject({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(calls[0]?.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'You map an agent.',
      messages: [{ role: 'user', content: 'SECTION: stages' }],
    });
  });

  it('reads ANTHROPIC_MODEL and ANTHROPIC_BASE_URL, and passes maxTokens', async () => {
    const { fetch, calls } = fakeFetch(message([{ type: 'text', text: 'ok' }]));
    const port = createAnthropicPort({
      env: { ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_BASE_URL: 'https://proxy.example.com/' },
      fetch,
    });
    await port.complete({ ...REQUEST, maxTokens: 2000 });
    expect(port.model).toBe('claude-sonnet-5-5');
    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/messages');
    expect(calls[0]?.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 2000 });
  });

  it('joins the text blocks and leaves thinking blocks out', async () => {
    const { fetch } = fakeFetch(
      message([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '1}' },
      ]),
    );
    expect(await createAnthropicPort({ env: ENV, fetch }).complete(REQUEST)).toBe('{"a":1}');
  });

  it('turns a refusal, a cut answer and an empty answer into errors', async () => {
    const refusal = fakeFetch(message([{ type: 'text', text: '' }], 'refusal'));
    expect(
      (await failure(createAnthropicPort({ env: ENV, fetch: refusal.fetch }).complete(REQUEST))).code,
    ).toBe('refusal');
    const cut = fakeFetch(message([{ type: 'text', text: '{"sec' }], 'max_tokens'));
    expect((await failure(createAnthropicPort({ env: ENV, fetch: cut.fetch }).complete(REQUEST))).code).toBe(
      'truncated',
    );
    const empty = fakeFetch(message([{ type: 'thinking', thinking: '' }]));
    expect(
      (await failure(createAnthropicPort({ env: ENV, fetch: empty.fetch }).complete(REQUEST))).code,
    ).toBe('empty');
  });

  it('reports a 400 with the provider error type and message, without a retry', async () => {
    const { fetch, calls } = fakeFetch(
      json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } },
        400,
      ),
    );
    const error = await failure(createAnthropicPort({ env: ENV, fetch }).complete(REQUEST));
    expect(error.code).toBe('http');
    expect(error.status).toBe(400);
    expect(error.message).toBe('400 invalid_request_error: max_tokens: too large');
    expect(calls).toHaveLength(1);
  });

  it('retries an overloaded answer after the retry-after delay, then reads the answer', async () => {
    const { sleep, waits } = recordSleep();
    const { fetch, calls } = fakeFetch(
      json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529, {
        'retry-after': '2',
      }),
      message([{ type: 'text', text: 'ok' }]),
    );
    expect(await createAnthropicPort({ env: ENV, fetch, sleep }).complete(REQUEST)).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('gives up after two retries on a network failure', async () => {
    const { sleep, waits } = recordSleep();
    const down = () => new TypeError('fetch failed');
    const { fetch, calls } = fakeFetch(down(), down(), down());
    const error = await failure(createAnthropicPort({ env: ENV, fetch, sleep }).complete(REQUEST));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it('refuses to start without ANTHROPIC_API_KEY', () => {
    expect(() => createAnthropicPort({ env: {} })).toThrowError(/ANTHROPIC_API_KEY is not set/);
    expect(() => createAnthropicPort({ env: { ANTHROPIC_API_KEY: '  ' } })).toThrowError(ModelError);
  });

  it('never shows the key: not on the port, not in an error', async () => {
    const { fetch } = fakeFetch(
      json({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401),
    );
    const port = createAnthropicPort({ env: ENV, fetch });
    expect(JSON.stringify(port)).not.toContain(KEY);
    expect(String(Object.values(port))).not.toContain(KEY);
    const error = await failure(port.complete(REQUEST));
    expect(`${error.message} ${error.stack}`).not.toContain(KEY);
  });
});
