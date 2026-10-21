import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugMiss, referenceBugsMiss } from './reference/bugs-miss';

/**
 * Two items of the round 3 repairs. `replay.miss-names-labeler` requires, as a token, the labeler id of the
 * missing entry (the id its own fixture declares), not the word `labeler`. `labels.haiku-stop-reason-refused`
 * requires one retry of a refused system 2 answer, never none and never two. Each passes on the reference
 * reader, on two seeds, and fails on the reference with the defect it guards planted
 * (`reference/bugs-miss.ts`).
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
  referenceBugsMiss.clear();
});

const ITEMS = [
  'replay.miss-names-labeler',
  'labels.haiku-stop-reason-refused',
  'replay.miss-nearest-same-labeler',
];

/** Each planted defect, the item that guards it, and the words its failure must carry. */
const PLANTED: Array<{ bug: BugMiss; id: string; detail: RegExp }> = [
  {
    bug: 'miss-omits-labeler-id',
    id: 'replay.miss-names-labeler',
    detail: /the miss does not name the labeler id anthropic of the missing entry/,
  },
  {
    // The old oracle passed this one: the miss holds the word `labeler`, with the id of another labeler.
    bug: 'miss-names-cassette-labeler',
    id: 'replay.miss-names-labeler',
    detail: /the miss does not name the labeler id anthropic of the missing entry: .*labeler jev/,
  },
  {
    bug: 'haiku-retry-removed',
    id: 'labels.haiku-stop-reason-refused',
    detail: /stop reason max_tokens: 0 retried requests, expected 1/,
  },
  {
    bug: 'haiku-second-retry',
    id: 'labels.haiku-stop-reason-refused',
    detail: /stop reason max_tokens twice: 2 retried requests, expected 1/,
  },
];

describe('the miss and retry items pass on the reference reader', () => {
  for (const id of ITEMS) {
    it(id, async () => {
      for (const seed of [1, 2])
        expect(await run(id, seed), `${id} seed ${seed}`).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each item fails on the reference with the defect it guards', () => {
  for (const { bug, id, detail } of PLANTED) {
    it(`${id} fails when the reader has the defect ${bug}`, async () => {
      referenceBugsMiss.add(bug);
      const planted = await run(id);
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(detail);
    }, 120_000);
  }

  it('a miss naming the missing entry by its own labeler id passes both cassette miss items', async () => {
    // The bugsD item forbids naming another labeller's entry as the nearest; naming the own id is not that.
    for (const id of ['replay.miss-names-labeler', 'replay.miss-nearest-same-labeler'])
      expect(await run(id), id).toMatchObject({ pass: true });
  }, 120_000);
});
