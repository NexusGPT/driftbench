import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { referenceBugs } from './reference/ports';

/**
 * The system 1 items rewritten for the choice contract of the reader (round 3, seat 3): the `system1` client
 * asks one choice question per unit, the labels and `none` as options, and takes the highest option; the
 * threshold items run on the yes or no arm `openai-decisions`. Each item passes on the reference reader and
 * fails on the reference with one planted bug of its class.
 */

type Bug = Parameters<typeof referenceBugs.add>[0];

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

async function run(id: string) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    return await runItem(item(id), 1, ref);
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

afterEach(() => {
  referenceBugs.clear();
});

const REWRITTEN = [
  'labels.jev-threshold-window',
  'labels.jev-threshold-unit',
  'labels.jev-threshold-is-a-replay-setting',
  'labels.jev-question-keys',
  'labels.jev-window-cap',
  'labels.jev-halve-on-refusal',
  'labels.jev-unit-state-one-call-per-unit',
  'labels.jev-probabilities-recorded',
];
const DECISIONS = [
  'labels.decisions-threshold-window',
  'labels.decisions-threshold-set-by-caller',
  'labels.decisions-threshold-is-a-replay-setting',
];
/** Items of the same port left as they were: they still hold on the choice contract. */
const UNCHANGED = ['labels.jev-highest-not-first', 'labels.jev-none-below-threshold'];

/** Each item with a planted bug of its class and the words its failure must carry. */
const PLANTED: Array<{ id: string; bug: Bug; detail: RegExp }> = [
  { id: 'labels.jev-threshold-window', bug: 'threshold-over-labels', detail: /the highest option is/ },
  { id: 'labels.jev-threshold-window', bug: 'normalise', detail: /no vector is refused, never normalised/ },
  { id: 'labels.jev-threshold-unit', bug: 'threshold-over-labels', detail: /the highest option is/ },
  {
    id: 'labels.jev-threshold-unit',
    bug: 'unit-state-window',
    detail: /calls for 12 units in the unit state/,
  },
  {
    id: 'labels.jev-threshold-is-a-replay-setting',
    bug: 'threshold-over-labels',
    detail: /must be rule|expected rule/,
  },
  { id: 'labels.jev-question-keys', bug: 'no-none-option', detail: /offers .*, expected five, four, none/ },
  { id: 'labels.jev-window-cap', bug: 'window-60', detail: /at most 30 fit in one|the cap is 30 units/ },
  { id: 'labels.jev-halve-on-refusal', bug: 'no-halving', detail: /the endpoint refused the window/ },
  { id: 'labels.jev-unit-state-one-call-per-unit', bug: 'unit-state-window', detail: /calls for 25 units/ },
  { id: 'labels.jev-probabilities-recorded', bug: 'drop-none-probability', detail: /__none/ },
  {
    id: 'labels.decisions-threshold-window',
    bug: 'decisions-threshold-0.5',
    detail: /has label none, expected/,
  },
  {
    id: 'labels.decisions-threshold-set-by-caller',
    bug: 'ignores-caller-threshold',
    detail: /, expected none/,
  },
  {
    id: 'labels.decisions-threshold-is-a-replay-setting',
    bug: 'threshold-in-key',
    detail: /the replay at another threshold failed/,
  },
];

describe('the system 1 items pass on the reference reader', () => {
  for (const id of [...REWRITTEN, ...DECISIONS, ...UNCHANGED]) {
    it(id, async () => {
      expect(await run(id), id).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each system 1 item fails on a reference with a planted bug of its class', () => {
  for (const { id, bug, detail } of PLANTED) {
    it(`${id} fails when the reader has the bug ${bug}`, async () => {
      referenceBugs.add(bug);
      const planted = await run(id);
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(detail);
    }, 120_000);
  }

  it('covers every rewritten and added item with a planted bug', () => {
    const covered = new Set(PLANTED.map((p) => p.id));
    for (const id of [...REWRITTEN, ...DECISIONS]) expect(covered.has(id), id).toBe(true);
  });
});
