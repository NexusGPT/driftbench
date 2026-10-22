import type { ItemContext } from '../../bank/item';
import type { StoreDoc } from '../../interface';
import {
  assertCovered,
  assertRowsSound,
  callPlan,
  makeStore,
  names,
  type Stem,
  spaceOf,
  valueIds,
} from '../kit';

/** Rules that the projection states apart from `rules`: a boundary that names a rule, a value with when or unless. */

function planned(ctx: ItemContext, store: StoreDoc): void {
  const space = spaceOf(store);
  const plan = callPlan(ctx, store, { seed: ctx.seed });
  assertRowsSound(space, plan, []);
  assertCovered(space, plan, []);
}

export const PORTRULES_STEMS: readonly Stem[] = [
  {
    id: 'portrules.rules',
    rules: ['R6'],
    family: 'strength',
    component: 'planner/strength',
    cause:
      'the plan crosses at strength 3 every variable a rule names through a boundary or through when and unless',
    cases: [
      [
        'boundary-names-a-rule-and-joins-it',
        3,
        (ctx) => {
          const [a, b, c] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['below', 'at', 'above'] },
              { id: b, values: valueIds(3) },
              { id: c, values: valueIds(3) },
            ],
            rules: [{ id: 'limit.rule', variables: [b, c] }],
          });
          (store.variables[0] as StoreDoc['variables'][number]).boundaries = [
            { holds: 'above', fails: 'below', edge: 'at', limit: 5, comparison: 'gt', rule: 'limit.rule' },
          ];
          planned(ctx, store);
        },
      ],
      [
        'a-value-with-when-is-a-rule',
        3,
        (ctx) => {
          const [x, y, z] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: x, values: valueIds(3) },
              { id: y, values: valueIds(3) },
              { id: z, values: valueIds(3) },
            ],
          });
          (store.variables[0]?.values[0] as { when?: Record<string, string[]> }).when = {
            [y]: ['v0'],
            [z]: ['v1'],
          };
          planned(ctx, store);
        },
      ],
      [
        'a-value-with-unless-is-a-rule',
        3,
        (ctx) => {
          const [x, y, z] = names(ctx.rng, 3) as [string, string, string];
          const store = makeStore({
            vars: [
              { id: x, values: valueIds(3) },
              { id: y, values: valueIds(3) },
              { id: z, values: valueIds(3) },
            ],
          });
          (store.variables[1]?.values[2] as { unless?: Record<string, string[]> }).unless = {
            [x]: ['v0'],
            [z]: ['v2'],
          };
          planned(ctx, store);
        },
      ],
    ],
  },
];
