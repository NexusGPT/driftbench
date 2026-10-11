/**
 * Text similarity in code, with no embedding service: character n-gram TF-IDF vectors and their cosine.
 * Character n-grams survive typos, inflection and short messages better than words, and they need no
 * model, so two runs on the same texts give the same numbers.
 */

/** A sparse vector: n-gram to weight. L2-normalised when it comes from `tfidf`. */
export type GramVector = Map<string, number>;

export type GramOptions = {
  /** Shortest n-gram. Default 3. */
  min?: number;
  /** Longest n-gram. Default 5. */
  max?: number;
};

/** Lower case, Unicode NFKC, white space folded to one space, trimmed. */
export function normaliseText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The character n-grams of a text and their counts, the text padded with one space on each side. */
export function charGrams(text: string, options: GramOptions = {}): Map<string, number> {
  const min = options.min ?? 3;
  const max = options.max ?? 5;
  const padded = ` ${normaliseText(text)} `;
  const counts = new Map<string, number>();
  for (let n = min; n <= max; n += 1) {
    for (let start = 0; start + n <= padded.length; start += 1) {
      const gram = padded.slice(start, start + n);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * TF-IDF vectors of the texts, fitted on these texts: weight = count x idf with the smooth idf
 * ln((1 + N) / (1 + df)) + 1 (the scikit-learn default), then L2-normalised. A text with no n-gram (an
 * empty one) gets an empty vector, whose cosine with anything is 0.
 */
export function gramTfidf(texts: readonly string[], options: GramOptions = {}): GramVector[] {
  const grams = texts.map((text) => charGrams(text, options));
  const df = new Map<string, number>();
  for (const counts of grams) for (const gram of counts.keys()) df.set(gram, (df.get(gram) ?? 0) + 1);
  const total = texts.length;
  return grams.map((counts) => {
    const vector: GramVector = new Map();
    let norm = 0;
    for (const [gram, count] of counts) {
      const weight = count * (Math.log((1 + total) / (1 + (df.get(gram) ?? 0))) + 1);
      vector.set(gram, weight);
      norm += weight * weight;
    }
    const length = Math.sqrt(norm);
    if (length > 0) for (const [gram, weight] of vector) vector.set(gram, weight / length);
    return vector;
  });
}

/** The cosine of two L2-normalised vectors: their dot product. */
export function gramCosine(a: GramVector, b: GramVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [gram, weight] of small) {
    const other = large.get(gram);
    if (other !== undefined) dot += weight * other;
  }
  return Math.min(1, Math.max(0, dot));
}

export type GramNeighbour = { index: number; score: number };

/**
 * For each query vector, the most similar vector of the pool and its cosine (index -1 and score 0 when the
 * pool is empty). With `self`, the query and the pool are the same list and a vector is never its own
 * neighbour.
 */
export function nearestNeighbours(
  queries: readonly GramVector[],
  pool: readonly GramVector[],
  self = false,
): GramNeighbour[] {
  return queries.map((query, q) => {
    let best: GramNeighbour = { index: -1, score: 0 };
    pool.forEach((candidate, p) => {
      if (self && p === q) return;
      const score = gramCosine(query, candidate);
      if (best.index === -1 || score > best.score) best = { index: p, score };
    });
    return best;
  });
}

/**
 * Leader clustering, in order: a vector joins the most similar existing leader when the cosine is at least
 * `threshold`, else it becomes a new leader. Returns the cluster of each vector, numbered from 0 in the
 * order the leaders appear. Deterministic for a given order.
 */
export function leaderClusters(vectors: readonly GramVector[], threshold: number): number[] {
  const leaders: number[] = [];
  return vectors.map((vector, index) => {
    let best = -1;
    let bestScore = -1;
    leaders.forEach((leader, cluster) => {
      const score = gramCosine(vector, vectors[leader] as GramVector);
      if (score >= threshold && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    });
    if (best !== -1) return best;
    leaders.push(index);
    return leaders.length - 1;
  });
}

/** The words of a text: runs of letters, digits and apostrophes, lower case. */
export function wordsOf(text: string): string[] {
  return normaliseText(text).match(/[\p{L}\p{N}']+/gu) ?? [];
}
