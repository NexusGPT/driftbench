/**
 * Text similarity for the intake. The gram primitives (n-grams, TF-IDF, cosine, words) live in
 * @agent-nexus/driftbench-core, shared with the similarity check; this file adds neighbours and clusters.
 */
import { type GramVector, gramCosine } from '@agent-nexus/driftbench-core';

export {
  charGrams,
  type GramOptions,
  type GramVector,
  gramCosine,
  gramTfidf,
  normaliseText,
  wordsOf,
} from '@agent-nexus/driftbench-core';

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
