import type { Embedder } from '../contracts/embedder';
import { denseEmbedder } from './embedder';

/**
 * An embedder over an OpenAI-compatible `POST {baseUrl}/embeddings` endpoint: the request carries the model and
 * the two texts; the response's vectors are read by their `index`, not by their position in the list. The key
 * goes only in the Authorization header, never in the evidence id or an error message. Scores from this
 * embedder are semantic only to the extent the model is; the local character n-gram embedder is lexical.
 */
export type OpenAiCompatibleOptions = {
  /** The API root, such as https://api.example.com/v1. The path /embeddings is added. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** The transport. Defaults to the global fetch; a test passes its own. */
  fetch?: typeof globalThis.fetch;
};

export function openAiCompatibleEmbedder(options: OpenAiCompatibleOptions): Embedder {
  const transport = options.fetch ?? globalThis.fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  return denseEmbedder({
    id: `openai-compatible:${options.model}`,
    async embed(texts) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
      const response = await transport(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, input: [...texts] }),
      });
      const payload = (await response.json().catch(() => undefined)) as
        | { data?: { index?: number; embedding?: number[] }[]; error?: { message?: string } }
        | undefined;
      if (!response.ok) {
        const reason = payload?.error?.message ?? 'no message';
        throw new Error(`embeddings endpoint answered ${response.status}: ${reason}`);
      }
      const rows = payload?.data;
      if (!Array.isArray(rows)) throw new Error('embeddings endpoint answered without a data list');
      return texts.map((_, index) => {
        const row = rows.find((entry) => entry.index === index);
        if (!row || !Array.isArray(row.embedding)) throw new Error(`no vector for input ${index}`);
        return row.embedding;
      });
    },
  });
}
