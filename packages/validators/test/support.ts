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

/** A valid journal row for the planted ladder: iteration n, seeds 1 and hidden, level 1 to 3. */
export function journalRow(iteration = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iteration,
    at: '2026-10-11T09:00:00Z',
    model: 'opus',
    seeds: ['1', 'hidden'],
    command: 'pnpm driftbench validate planted --seed 1 --hidden',
    level: { before: 1, after: 3 },
    perSeed: [
      { seed: '1', before: 1, after: 3 },
      { seed: 'hidden', before: 1, after: 3 },
    ],
    metrics: [
      { level: 1, id: 'first', metric: 'kept / planted', threshold: 1, before: 1, after: 1 },
      { level: 2, id: 'second', metric: 'found / planted', threshold: 0.9, before: 0.5, after: 1 },
      { level: 3, id: 'third', metric: 'false alarms / runs', threshold: 0.05, before: null, after: 0 },
    ],
    failingBefore: ['plant-1-a', 'plant-1-b'],
    hypothesis: 'The finder drops the last planted item because its loop stops one short.',
    research: null,
    change: { files: ['fixture/finder.ts'], commit: 'abc1234' },
    testsAdded: ['finder keeps the last planted item'],
    result: 'raised',
    durationMinutes: 12,
    tokenEstimate: 40000,
    ...overrides,
  };
}
