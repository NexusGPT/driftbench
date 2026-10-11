import { describe, expect, it } from 'vitest';
import {
  charGrams,
  gramCosine,
  gramTfidf,
  leaderClusters,
  nearestNeighbours,
  normaliseText,
  wordsOf,
} from '../../src/intake';

describe('character n-gram TF-IDF', () => {
  it('normalises case, width and white space before cutting n-grams', () => {
    expect(normaliseText('  Hello\tWORLD  ')).toBe('hello world');
    expect([...charGrams('ab', { min: 2, max: 3 }).keys()]).toEqual([' a', 'ab', 'b ', ' ab', 'ab ']);
  });

  it('gives 1 for the same text, 0 for texts with no n-gram in common, and unit-length vectors', () => {
    const [a, b, c] = gramTfidf(['more data please', 'More  data please', 'zzz']);
    expect(gramCosine(a as Map<string, number>, b as Map<string, number>)).toBeCloseTo(1, 10);
    expect(gramCosine(a as Map<string, number>, c as Map<string, number>)).toBe(0);
    const norm = [...(a as Map<string, number>).values()].reduce((sum, w) => sum + w * w, 0);
    expect(norm).toBeCloseTo(1, 10);
  });

  it('scores a paraphrase above an unrelated text', () => {
    const [query, close, far] = gramTfidf([
      'I want a plan with more data',
      'can I get a plan with more data?',
      'do you cover my street for fibre',
    ]);
    const q = query as Map<string, number>;
    expect(gramCosine(q, close as Map<string, number>)).toBeGreaterThan(
      gramCosine(q, far as Map<string, number>),
    );
  });

  it('weights a rare n-gram above a common one (smooth idf)', () => {
    const vectors = gramTfidf(['aaa bbb', 'aaa ccc', 'aaa ddd']);
    const first = vectors[0] as Map<string, number>;
    expect(first.get('bbb') ?? 0).toBeGreaterThan(first.get('aaa') ?? 0);
  });
});

describe('neighbours and clusters', () => {
  it('finds the nearest pool vector, never itself in self mode', () => {
    const vectors = gramTfidf(['more data', 'more data please', 'fibre at my street']);
    expect(nearestNeighbours(vectors, vectors, true).map((n) => n.index)).toEqual([1, 0, 0]);
    expect(nearestNeighbours(vectors, [])[0]).toEqual({ index: -1, score: 0 });
  });

  it('clusters by leader in order, deterministically', () => {
    const vectors = gramTfidf(['more data', 'fibre here?', 'more data please', 'fibre here please?', 'xyz']);
    expect(leaderClusters(vectors, 0.4)).toEqual([0, 1, 0, 1, 2]);
    expect(leaderClusters(vectors, 1.01)).toEqual([0, 1, 2, 3, 4]);
  });

  it('splits words on letters, digits and apostrophes', () => {
    expect(wordsOf("I'd like 20 GB, thanks!")).toEqual(["i'd", 'like', '20', 'gb', 'thanks']);
  });
});
