import { bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import { type JudgesV3Options, judgesLadderV3 } from '../v3/index';
import { loadPointerImpl, POINTER_FIXTURES, type PointerItem, pointerBank, pointerFixtures } from './pointer';

export * from './pointer';

export type JudgesV4Options = JudgesV3Options & { pointerBank?: PointerItem[] };

/**
 * Version 4 is version 3 (the fixed-label labeller bank) plus a level for the pointer labellers of
 * packages/estate: the same component, the real code, tables for models. Versions 2 and 3 stay as they are.
 */
export function judgesLadderV4(options: JudgesV4Options = {}): Ladder {
  const v3 = judgesLadderV3(options);
  const bank = options.pointerBank ?? pointerBank();
  return defineLadder({
    component: 'judges',
    version: 4,
    levels: [
      ...v3.levels,
      {
        id: 'pointer-labellers',
        name: 'pointer labellers: answer checks, label-set hash, yes or no and choice readers, stack, recording, gold set',
        metric: `pointer labeller items matching the documented rules / ${bank.length} items (${POINTER_FIXTURES})`,
        threshold: 1,
        async compute({ root }) {
          const fixtures = pointerFixtures(root);
          const impl = await loadPointerImpl();
          const results = [];
          for (const item of bank) {
            let misses: string[];
            try {
              misses = await item.run(impl, fixtures);
            } catch (cause) {
              misses = [
                `threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
              ];
            }
            results.push({
              id: item.id,
              family: item.family,
              tier: item.tier,
              component: item.component,
              cause: item.cause,
              pass: misses.length === 0,
              detail:
                misses.length === 0
                  ? undefined
                  : `${misses.length} of its cases differ: ${misses.slice(0, 3).join(' | ')}${misses.length > 3 ? ` | and ${misses.length - 3} more` : ''}. Fix ${item.component}.`,
            });
          }
          return bankMeasure(results, 'packages/estate/src/pointer');
        },
      },
    ],
  });
}
