import { bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import { type JudgesV3Options, judgesLadderV3 } from '../v3/index';
import { POINTER_FIXTURES, type PointerItem, pointerBank } from './pointer';
import { runPointerChild } from './run-child';

export * from './pointer';
export { pointerBankChild } from './pointer-child';
export * from './run-child';

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
        async compute({ root, seed }) {
          const rows = await runPointerChild(seed, root);
          const results = rows.map((row) => ({
            id: row.id,
            family: row.family,
            tier: row.tier as 1 | 2 | 3 | 4 | 5,
            component: row.component,
            cause: row.cause,
            pass: row.misses.length === 0,
            detail:
              row.misses.length === 0
                ? undefined
                : `${row.misses.length} of its cases differ: ${row.misses.slice(0, 3).join(' | ')}${row.misses.length > 3 ? ` | and ${row.misses.length - 3} more` : ''}. Fix ${row.component}.`,
          }));
          return bankMeasure(results, 'packages/estate/src/pointer');
        },
      },
    ],
  });
}
