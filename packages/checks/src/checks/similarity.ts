import {
  type Check,
  type Embedder,
  localEmbedder,
  machineVerdict,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { message } from '../support/assert';
import { quote, visibleText } from '../support/text';

const NAME = 'similarity';

/**
 * `expect.similarity`: the reply against each reference text, scored by an embedder from 0 to 1; the
 * verdict passes at the entry's `min` or above, carries the score, and names the embedder in its evidence.
 * The default embedder is local (character n-gram TF-IDF cosine, no network); another plugs in through the
 * embedder port. An embedder that fails gives an inconclusive verdict that says why.
 */
export function createSimilarityCheck(embedder: Embedder = localEmbedder): Check {
  return {
    name: NAME,
    applies: (ctx) => (ctx.expect.similarity?.length ?? 0) > 0,
    async evaluate(ctx) {
      const reply = visibleText(ctx.observed);
      const verdicts: Verdict[] = [];
      for (const [index, entry] of (ctx.expect.similarity ?? []).entries()) {
        const id = String(index);
        let score: number;
        try {
          score = await embedder.similarity(reply, entry.reference);
        } catch (cause) {
          verdicts.push(
            machineVerdict(
              NAME,
              id,
              'inconclusive',
              `${embedder.id} could not score the reply: ${message(cause)}`,
            ),
          );
          continue;
        }
        verdicts.push(
          machineVerdict(
            NAME,
            id,
            score >= entry.min ? 'pass' : 'fail',
            `${embedder.id} scored ${score.toFixed(2)} against the reference, at least ${entry.min.toFixed(2)} expected: ${quote(entry.reference)}`,
            { score },
          ),
        );
      }
      return verdicts;
    },
  };
}

export const similarity: Check = createSimilarityCheck();
