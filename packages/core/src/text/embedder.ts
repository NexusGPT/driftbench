import type { Embedder } from '../contracts/embedder';
import { gramCosine, gramTfidf } from './grams';

/**
 * The default embedder: character n-grams of 3 to 5, TF-IDF fitted on the two texts, cosine. In code, with
 * no network and no key, so the same two texts always score the same.
 * It is lexical, not semantic: two texts that mean the same thing in different words score low.
 */
export const localEmbedder: Embedder = {
  id: 'char-ngram-tfidf',
  async similarity(a, b) {
    const [left, right] = gramTfidf([a, b]);
    return left && right ? gramCosine(left, right) : 0;
  },
};

export type DenseEmbedderOptions = {
  /** The name printed in the evidence, such as `provider:model`. */
  id: string;
  /** One call that turns texts into vectors of one length, in order: an embedding model behind a port. */
  embed(texts: readonly string[]): Promise<number[][]>;
};

/** An embedder over any embedding call: the cosine of the two vectors, clamped to 0 to 1. */
export function denseEmbedder(options: DenseEmbedderOptions): Embedder {
  return {
    id: options.id,
    async similarity(a, b) {
      const [left, right] = await options.embed([a, b]);
      if (!left || !right || left.length !== right.length) {
        throw new Error(`${options.id} returned no pair of vectors of one length`);
      }
      let dot = 0;
      let leftNorm = 0;
      let rightNorm = 0;
      left.forEach((value, index) => {
        const other = right[index] ?? 0;
        dot += value * other;
        leftNorm += value * value;
        rightNorm += other * other;
      });
      if (leftNorm === 0 || rightNorm === 0) return 0;
      return Math.min(1, Math.max(0, dot / Math.sqrt(leftNorm * rightNorm)));
    },
  };
}
