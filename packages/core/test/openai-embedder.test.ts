import { describe, expect, it } from 'vitest';
import { openAiCompatibleEmbedder } from '../src/text/openai-embedder';

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response, calls: Call[] = []) {
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('openAiCompatibleEmbedder', () => {
  it('posts the two texts to the endpoint and scores the cosine of the vectors it gets back', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [1, 1] },
        ],
      }),
    );
    const embedder = openAiCompatibleEmbedder({
      baseUrl: 'https://example.test/v1',
      model: 'm-1',
      apiKey: 'k-secret',
      fetch,
    });
    const score = await embedder.similarity('a', 'b');
    expect(score).toBeCloseTo(Math.SQRT1_2, 6);
    expect(calls[0]?.url).toBe('https://example.test/v1/embeddings');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ model: 'm-1', input: ['a', 'b'] });
    expect(embedder.id).toBe('openai-compatible:m-1');
  });

  it('puts the key in the header, and not in the evidence id or the body', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        data: [
          { index: 0, embedding: [1] },
          { index: 1, embedding: [1] },
        ],
      }),
    );
    const embedder = openAiCompatibleEmbedder({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      apiKey: 'k-secret',
      fetch,
    });
    await embedder.similarity('x', 'y');
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe('Bearer k-secret');
    expect(embedder.id).not.toContain('k-secret');
    expect(String(calls[0]?.init.body)).not.toContain('k-secret');
  });

  it('orders the vectors by their index, not by the order the endpoint lists them', async () => {
    const { fetch } = fakeFetch(() =>
      json({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    const embedder = openAiCompatibleEmbedder({ baseUrl: 'https://e.test', model: 'm', fetch });
    expect(await embedder.similarity('a', 'b')).toBeCloseTo(0, 6);
  });

  it('fails with the status and the endpoint message on an HTTP error, without the key', async () => {
    const { fetch } = fakeFetch(() => json({ error: { message: 'rate limited' } }, 429));
    const embedder = openAiCompatibleEmbedder({
      baseUrl: 'https://e.test',
      model: 'm',
      apiKey: 'k-secret',
      fetch,
    });
    const error = await embedder.similarity('a', 'b').catch((cause: Error) => cause);
    expect((error as Error).message).toMatch(/429.*rate limited/);
    expect((error as Error).message).not.toContain('k-secret');
  });

  it('refuses a response with a missing vector', async () => {
    const { fetch } = fakeFetch(() => json({ data: [{ index: 0, embedding: [1] }] }));
    const embedder = openAiCompatibleEmbedder({ baseUrl: 'https://e.test', model: 'm', fetch });
    await expect(embedder.similarity('a', 'b')).rejects.toThrow(/no vector for input 1/);
  });

  it('scores different vectors below one', async () => {
    const { fetch } = fakeFetch(() =>
      json({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [1, 1] },
        ],
      }),
    );
    const embedder = openAiCompatibleEmbedder({ baseUrl: 'https://e.test', model: 'm', fetch });
    expect(await embedder.similarity('a', 'b')).not.toBeCloseTo(1, 3);
  });
});
