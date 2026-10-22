import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_D_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-bugs-d';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugD, referenceBugsD } from './reference/bugs-d';

/**
 * The items of the round 3 audit, seat 4, for the planted bugs of the reader's stack, user labeler, cassette and
 * key code (`specs/hardening-bugs-d.ts`). Each item passes on the reference reader, on two seeds, and fails on
 * the reference with the one bug it guards planted: the same one-line change the audit planted in the reader,
 * modelled in `reference/bugs-d.ts`.
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
  referenceBugsD.clear();
});

const ITEMS = Object.entries(HARDENING_D_SPECS).flatMap(([family, specs]) =>
  specs.map((spec) => `${family}.${spec.key}`),
);

/** Each planted bug of the audit, the item that guards it, and the words its failure must carry. */
const PLANTED: Array<{ bug: BugD; id: string; detail: RegExp }> = [
  {
    bug: 'stack-margin-equal-defers',
    id: 'labels.stack-margin-at-cut-decides-by-system1',
    detail: /the cut, so system 1 decides/,
  },
  {
    bug: 'stack-system2-none-overrides',
    id: 'labels.stack-system2-none-keeps-sure-system1',
    detail: /holds none, expected .*a none from system 2 does not override it/,
  },
  {
    bug: 'stack-fallback-flag-dropped',
    id: 'labels.stack-fallback-counts-sure-system1-alone',
    detail: /fellBack is 0, expected/,
  },
  {
    bug: 'w-stack-system1-missing-undecided',
    id: 'labels.stack-system1-missing-system2-decides',
    detail: /holds no label, expected .*system 2 decides alone/,
  },
  {
    bug: 'stack-hash-ignores-runs',
    id: 'labels.labeler-runs-change-relabels',
    detail: /sent it nothing: the runs decide a label/,
  },
  {
    bug: 'stack-hash-ignores-settings',
    id: 'labels.labeler-settings-change-relabels',
    detail: /threshold 0\.8 sent no request/,
  },
  {
    bug: 'w-user-http-id-constant',
    id: 'labels.http-labeler-address-change-relabels',
    detail: /at another address sent no request/,
  },
  {
    bug: 'replay-halve-floor',
    id: 'replay.too-large-halves-larger-first',
    detail: /the larger half first/,
  },
  {
    bug: 'cassette-nearest-any-labeler',
    id: 'replay.miss-nearest-same-labeler',
    detail: /names an entry of another labeller as the nearest/,
  },
  {
    bug: 'replay-miss-names-farthest',
    id: 'replay.miss-names-least-different-entry',
    detail: /names an entry of another run/,
  },
  {
    bug: 'privacy-getter-key-read-early',
    id: 'privacy.key-getter-not-read-when-nothing-sent',
    detail: /sent nothing and read the key 1 times/,
  },
];

describe('the seat 4 bug items pass on the reference reader', () => {
  for (const id of ITEMS) {
    it(id, async () => {
      for (const seed of [1, 2])
        expect(await run(id, seed), `${id} seed ${seed}`).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each seat 4 bug item fails on the reference with its planted bug', () => {
  for (const { bug, id, detail } of PLANTED) {
    it(`${id} fails when the reader has the bug ${bug}`, async () => {
      referenceBugsD.add(bug);
      const planted = await run(id);
      expect(planted.pass, id).toBe(false);
      expect(planted.detail, id).toMatch(detail);
    }, 120_000);
  }

  it('guards every planted bug with an item, and every item guards a bug', () => {
    expect(new Set(PLANTED.map((p) => p.id))).toEqual(new Set(ITEMS));
    expect(PLANTED).toHaveLength(11);
  });
});
