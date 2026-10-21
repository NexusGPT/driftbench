import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type DecisionsBug, decisionsBugs } from './reference/bugs-decisions';

/**
 * The request items of the yes or no arm `openai-decisions`: the predicate names `u<n>__<label>`, the cap of
 * 100 questions per request and the record of every probability. They restore, on the arm that still asks yes
 * or no questions, what the old yes or no items of the `system1` client checked before that client moved to
 * choice questions. Each item passes on the reference reader, on seeds 1 to 3, and fails on the reference
 * with one planted bug of its class.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

async function run(id: string, seed = 1) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    return await runItem(item(id), seed, ref);
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

afterEach(() => {
  decisionsBugs.clear();
});

const ADDED = [
  'labels.decisions-predicate-names',
  'labels.decisions-question-cap',
  'labels.decisions-probabilities-recorded',
];

/** Each item with a planted bug of its class and the words its failure must carry. */
const PLANTED: Array<{ id: string; bug: DecisionsBug; detail: RegExp }> = [
  {
    id: 'labels.decisions-predicate-names',
    bug: 'unit-number-fixed',
    detail: /names the predicate u1__\w+ twice/,
  },
  { id: 'labels.decisions-question-cap', bug: 'cap-250', detail: /questions \(3 labels\), the cap is 100/ },
  {
    id: 'labels.decisions-question-cap',
    bug: 'unit-number-fixed',
    detail: /names the predicate u1__\w+ twice/,
  },
  {
    id: 'labels.decisions-probabilities-recorded',
    bug: 'record-above-threshold-only',
    detail: /no cassette entry holds its \d+ probabilities as answered/,
  },
];

describe('the openai-decisions request items pass on the reference reader', () => {
  for (const id of ADDED) {
    for (const seed of [1, 2, 3]) {
      it(`${id} seed ${seed}`, async () => {
        expect(await run(id, seed), id).toMatchObject({ pass: true });
      }, 120_000);
    }
  }
});

describe('each openai-decisions request item fails on a reference with a planted bug of its class', () => {
  for (const { id, bug, detail } of PLANTED) {
    it(`${id} fails when the reader has the bug ${bug}`, async () => {
      decisionsBugs.add(bug);
      const planted = await run(id);
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(detail);
    }, 120_000);
  }

  it('the existing replay item stays green with the probabilities under the threshold dropped', async () => {
    // The existing item records at 0.4 and replays at 0.9: the probabilities it needs are all kept. The
    // new item replays at a lower threshold, so it needs the ones under the threshold: the coverage added.
    decisionsBugs.add('record-above-threshold-only');
    expect(await run('labels.decisions-threshold-is-a-replay-setting')).toMatchObject({ pass: true });
  }, 120_000);

  it('covers every added item with a planted bug', () => {
    const covered = new Set(PLANTED.map((p) => p.id));
    for (const id of ADDED) expect(covered.has(id), id).toBe(true);
  });
});
