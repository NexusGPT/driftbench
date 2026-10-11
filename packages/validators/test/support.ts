import { defineLadder, type Ladder } from '../src/index';

/** A fixture ladder of three levels. Level 2 fails on the seeds listed in `failOn`; the calls are counted. */
export function plantedLadder(failOn: readonly number[] = [1, 2, 3], component = 'planted') {
  const calls = { first: 0, second: 0, third: 0 };
  const ladder: Ladder = defineLadder({
    component,
    levels: [
      {
        id: 'first',
        name: 'first rung',
        metric: 'kept / planted',
        threshold: 1,
        compute: () => {
          calls.first += 1;
          return { value: 1, items: [] };
        },
      },
      {
        id: 'second',
        name: 'second rung',
        metric: 'found / planted',
        threshold: 0.9,
        compute: ({ seed }) => {
          calls.second += 1;
          if (!failOn.includes(seed)) return { value: 1, items: [] };
          return {
            value: 0.5,
            items: [
              { id: `plant-${seed}-a`, component: 'fixture/finder', detail: 'the planted item a was missed' },
              { id: `plant-${seed}-b`, component: 'fixture/finder', detail: 'the planted item b was missed' },
            ],
          };
        },
      },
      {
        id: 'third',
        name: 'third rung',
        metric: 'false alarms / runs',
        threshold: 0.05,
        direction: 'atMost',
        compute: () => {
          calls.third += 1;
          return { value: 0, items: [] };
        },
      },
    ],
  });
  return { ladder, calls };
}
