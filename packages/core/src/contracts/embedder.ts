/**
 * The embedder port: how similar two texts are, from 0 to 1. The similarity check scores a reply against a
 * reference with it and names it in the evidence. The default, `localEmbedder`, needs no network; any
 * embedding model plugs in through `denseEmbedder`, which takes one call that turns texts into vectors.
 */
export interface Embedder {
  /** The embedder's name, printed in the evidence of every score it gives: `char-ngram-tfidf`, `provider:model`. */
  readonly id: string;
  similarity(a: string, b: string): Promise<number>;
}
