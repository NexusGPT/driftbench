import { assertRowsSound, callPlan, makeStore, must, names, planError, type Stem, show, spaceOf, valueIds } from '../kit';

/** Seed ids (docs/variables.md R8): a seed row may carry an id, and two seed rows may not share one. */
export const SEEDIDS_STEMS: readonly Stem[] = [
  {
    id: 'seedids.ids',
    rules: ['R8'],
    family: 'seed-rows',
    component: 'planner/seeds',
    cause: 'the plan keeps the id a seed row carries and refuses two seed rows with one id by an Error that names it',
    cases: [
      [
        'two-seed-rows-with-one-id-are-refused',
        2,
        (ctx) => {
          const ids = names(ctx.rng, 3);
          const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(3), shared: true })) });
          const one = Object.fromEntries(ids.map((id) => [id, 'v0']));
          const two = Object.fromEntries(ids.map((id) => [id, 'v1']));
          const error = planError(ctx, store, { seed: ctx.seed, seeds: [one, two], seedIds: ['dup.1', 'dup.1'] });
          must(error.message.includes('dup.1'), () => `the Error says ${show(error.message)}; it should name the id dup.1`);
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
          const got = plan.rows.slice(0, 2).map((r) => r.id);
          must(
            got[0] === 'first.row' && got[1] === 'second.row' && plan.rows.slice(0, 2).every((r) => r.kind === 'seed'),
            () => `the seed rows are named ${show(got)}; the ids given were first.row and second.row`,
          );
        },
      ],
    ],
  },
];
