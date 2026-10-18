import { charGrams, denseEmbedder, gramCosine, gramTfidf, localEmbedder } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

describe('the local embedder: character n-gram TF-IDF cosine, no network', () => {
  it('names itself and scores a paraphrase above an unrelated text', async () => {
    expect(localEmbedder.id).toBe('char-ngram-tfidf');
    const reference = 'Your order is placed and will be active within one business day.';
    const close = await localEmbedder.similarity(
      'Done: the order is placed, active within one business day.',
      reference,
    );
    const far = await localEmbedder.similarity('Our stores are closed on Sunday.', reference);
    expect(close).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(0.2);
    expect(await localEmbedder.similarity(reference, reference)).toBeCloseTo(1, 10);
  });

  it('gives the same score on every run and 0 for an empty text', async () => {
    const a = await localEmbedder.similarity('the plan', 'the plans');
    expect(await localEmbedder.similarity('the plan', 'the plans')).toBe(a);
    expect(await localEmbedder.similarity('', 'anything')).toBe(0);
  });

  it('keeps the gram helpers the intake already used', () => {
    expect(charGrams('ab', { min: 3, max: 3 })).toEqual(
      new Map([
        [' ab', 1],
        ['ab ', 1],
      ]),
    );
    const [x, y] = gramTfidf(['acme plan', 'acme plan']);
    expect(gramCosine(x as Map<string, number>, y as Map<string, number>)).toBeCloseTo(1, 10);
  });
});

describe('a dense embedder over any embedding call', () => {
  it('scores the cosine of the two vectors the call returns, under its own id', async () => {
    const embedder = denseEmbedder({
      id: 'fake:dense',
      embed: async (texts) => texts.map((text) => (text.startsWith('a') ? [1, 0] : [0.6, 0.8])),
    });
    expect(embedder.id).toBe('fake:dense');
    expect(await embedder.similarity('a1', 'a2')).toBeCloseTo(1, 10);
    expect(await embedder.similarity('a1', 'b1')).toBeCloseTo(0.6, 10);
  });
});
