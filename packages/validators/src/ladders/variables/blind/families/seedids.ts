import { check } from '../../../../failure';
import { assertRowsSound, callPlan, makeStore, names, planError, type Stem, spaceOf, valueIds } from '../kit';

/** Seed ids (docs/variables.md R8): a seed row may carry an id, and two seed rows may not share one. */
export const SEEDIDS_STEMS: readonly Stem[] = [
  {
    id: 'seedids.ids',
    rules: ['R8'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause:
      'the plan keeps the id a seed row carries and refuses two seed rows with one id by an Error that names it',
    cases: [
      [
        'two-seed-rows-with-one-id-are-refused',
        2,
        (ctx) => {
          const ids = names(ctx.rng, 3);
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })) });
          const one = Object.fromEntries(ids.map((id) => [id, 'v0']));
          const two = Object.fromEntries(ids.map((id) => [id, 'v1']));
          const error = planError(ctx, store, {
            seed: ctx.seed,
            seeds: [one, two],
            seedIds: ['dup.1', 'dup.1'],
          });
          // The wanted value is the id the message names. It is the id the item gave, so the input says only that two
          // rows share one, and the id itself stays out of the message.
          check(error.message.includes('dup.1'), () => ({
            rule: 'the Error a plan raises for two seed rows that carry one id',
            input: { seedRows: 2, rowsSharingTheId: 2 },
            got: { message: error.message },
            expected: { messageNames: 'dup.1' },
          }));
        },
      ],
      [
        'distinct-seed-ids-are-kept',
        1,
        (ctx) => {
          const ids = names(ctx.rng, 3);
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })) });
          const seeds = [
            Object.fromEntries(ids.map((id) => [id, 'v0'])),
            Object.fromEntries(ids.map((id) => [id, 'v1'])),
          ];
          const plan = callPlan(ctx, store, { seed: ctx.seed, seeds, seedIds: ['first.row', 'second.row'] });
          assertRowsSound(spaceOf(store), plan, seeds);
          // Read before the check, so the message reads nothing the predicate did not.
          const first = plan.rows.slice(0, 2);
          const got = first.map((r) => r.id);
          const kinds = first.map((r) => r.kind);
          check(
            got[0] === 'seed.first.row' &&
              got[1] === 'seed.second.row' &&
              kinds.every((kind) => kind === 'seed'),
            () => ({
              rule: 'the ids and kinds of the first two rows when the supplied rows carry ids',
              input: { seedIds: ['first.row', 'second.row'] },
              got: { ids: got, kinds },
              expected: { ids: ['seed.first.row', 'seed.second.row'], kind: 'seed' },
            }),
          );
        },
      ],
    ],
  },
];
