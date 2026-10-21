import { bankMeasure, defineLadder, type JournalRow, type Ladder, measureHardness } from '../src/index';

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

/**
 * A valid journal row for the planted ladder: iteration n, seeds 1 and hidden. Iteration 0 is the baseline at
 * level 3; a later iteration raises the level from 1 to 3. The bank holds 10 items, 7 passing on every seed.
 */
export function journalRow(iteration = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const baseline = iteration === 0;
  const before = baseline ? 3 : 1;
  return {
    iteration,
    at: '2026-10-11T09:00:00Z',
    model: 'opus',
    seeds: ['1', 'hidden'],
    command: 'pnpm driftbench validate planted --seed 1 --hidden',
    level: { before, after: 3 },
    perSeed: [
      { seed: '1', before, after: 3 },
      { seed: 'hidden', before, after: 3 },
    ],
    metrics: [
      { level: 1, id: 'first', metric: 'kept / planted', threshold: 1, before: 1, after: 1 },
      { level: 2, id: 'second', metric: 'found / planted', threshold: 0.9, before: 0.5, after: 1 },
      { level: 3, id: 'third', metric: 'false alarms / runs', threshold: 0.05, before: null, after: 0 },
    ],
    bankSize: 10,
    passing: 7,
    failingByFamily: { alpha: 2, beta: 1 },
    bankByFamilyTier: { alpha: { '1': 4, '2': 2 }, beta: { '3': 4 } },
    failingBefore: ['plant-1-a', 'plant-1-b'],
    hypothesis: 'The finder drops the last planted item because its loop stops one short.',
    research: null,
    change: { files: ['fixture/finder.ts'], commit: 'abc1234' },
    testsAdded: ['finder keeps the last planted item'],
    result: baseline ? 'baseline' : 'raised',
    durationMinutes: 12,
    tokenEstimate: 40000,
    ...overrides,
  };
}

/**
 * A journal of rows 0 to passing.length - 1 on one family of `bankSize` items: row i has passing[i] items
 * passing on every seed. The level stays 1, so pilot rows are unchanged.
 */
export function journalOf(
  passing: readonly number[],
  bankSize: number,
  tiers: Record<string, number> = {},
  causes: (failing: number) => number | undefined = (failing) => failing,
): unknown[] {
  return passing.map((value, iteration) =>
    journalRow(iteration, {
      level: { before: 1, after: 1 },
      perSeed: [
        { seed: '1', before: 1, after: 1 },
        { seed: 'hidden', before: 1, after: 1 },
      ],
      bankSize,
      passing: value,
      failingByFamily: { core: bankSize - value },
      bankByFamilyTier: { core: Object.keys(tiers).length > 0 ? tiers : { '1': bankSize } },
      ...(causes(bankSize - value) !== undefined
        ? {
            failingCauses: causes(bankSize - value),
            // A row with failing items and 0 causes is valid only when every failing item is composite.
            ...(causes(bankSize - value) === 0 && bankSize - value > 0
              ? { failingComposite: bankSize - value }
              : {}),
            failingWithoutCause: 0,
          }
        : {}),
      result: iteration === 0 ? 'baseline' : 'unchanged',
    }),
  );
}

/**
 * A fixture ladder on a bank. Level 1 (core) holds six items in families alpha and beta; the item a3 fails on
 * the seeds in `failOn`. Level 2 (deep) holds four items of family gamma; g4 always fails. Calls are counted.
 */
export function bankLadder(failOn: readonly number[] = [2], options: { hints?: boolean } = {}) {
  const hint = (text: string) => (options.hints ? ` Fix: ${text}` : '');
  const calls = { core: 0, deep: 0 };
  const ladder: Ladder = defineLadder({
    component: 'banked',
    version: 2,
    levels: [
      {
        id: 'core',
        name: 'core bank',
        metric: 'items passing / items',
        threshold: 1,
        compute: ({ seed }) => {
          calls.core += 1;
          return bankMeasure(
            [
              { id: 'a1', component: 'fixture/a', family: 'alpha', tier: 1, pass: true },
              { id: 'a2', component: 'fixture/a', family: 'alpha', tier: 2, pass: true },
              {
                id: 'a3',
                component: 'fixture/a',
                family: 'alpha',
                tier: 3,
                pass: !failOn.includes(seed),
                detail: `a3 missed on seed ${seed}.${hint('keep the last field in the parser.')}`,
                cause: 'the parser drops the last field',
              },
              { id: 'b1', component: 'fixture/b', family: 'beta', tier: 1, pass: true },
              { id: 'b2', component: 'fixture/b', family: 'beta', tier: 4, pass: true },
              { id: 'b3', component: 'fixture/b', family: 'beta', tier: 5, pass: true },
            ],
            'banked',
          );
        },
      },
      {
        id: 'deep',
        name: 'deep bank',
        metric: 'items passing / items',
        threshold: 1,
        compute: () => {
          calls.deep += 1;
          return bankMeasure([
            { id: 'g1', component: 'fixture/g', family: 'gamma', tier: 2, pass: true },
            { id: 'g2', component: 'fixture/g', family: 'gamma', tier: 3, pass: true },
            { id: 'g3', component: 'fixture/g', family: 'gamma', tier: 3, pass: true },
            {
              id: 'g4',
              component: 'fixture/g',
              family: 'gamma',
              tier: 5,
              pass: false,
              detail: `g4 is unsolved.${hint('read the trailing field.')}`,
              cause: 'the parser drops the last field',
            },
          ]);
        },
      },
    ],
  });
  return { ladder, calls };
}

/** An audit.md where all four checks pass (section 12.7). */
export const PASSING_AUDIT = [
  '| Check | Verdict | Note |',
  '|---|---|---|',
  '| blind pilot | pass | |',
  '| cheater | pass | |',
  '| cause review | pass | |',
  '| planted bugs | pass | |',
  '',
].join('\n');

/** The hardness of journal rows with a passing audit by default, so a test measures everything else; null: no audit.md. */
export function hard(rows: readonly JournalRow[], audit: string | null = PASSING_AUDIT) {
  return measureHardness(rows, audit === null ? {} : { audit });
}
