import type { Block } from '../../kit/compose';
import { cutRun } from '../../kit/cut-case';
import { Prose } from '../../kit/words';
import { GOLDEN_GROUPS } from '../specs/golden';
import type { Run } from '../types';

/**
 * Each rule's README input as one paragraph, then the same sentences after a seeded prose sentence, so the rule is
 * also met at another place in a paragraph. The composer's truth is the README's expected sentences.
 */
export const goldenRuns: Record<string, Run> = Object.fromEntries(
  GOLDEN_GROUPS.map((group) => [
    group.key,
    cutRun((ctx) => {
      const prose = new Prose(ctx.seed, ctx.id);
      const blocks: Block[] = [];
      for (const rule of group.rules) {
        blocks.push({ kind: 'paragraph', sentences: [...rule.sentences], joiner: rule.joiner });
        blocks.push({ kind: 'paragraph', sentences: [prose.next(), ...rule.sentences], joiner: rule.joiner });
      }
      return blocks;
    }),
  ]),
);
