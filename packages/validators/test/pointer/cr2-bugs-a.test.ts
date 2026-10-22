import * as estate from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_BUGS_A_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-bugs-a';
import { type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugA, referenceBugsA } from './reference/bugs-a';

/**
 * Round 3 audit, seat 4: planted bugs of the cutter and the ledger that lost no item. Each item added for them
 * passes on the reference reader and on the reader as it is, and fails on the reference with the planted bug
 * modelled (`reference/bugs-a.ts`), with the reason it names. The same items run on GitHub against the reader with
 * each bug's one-line patch applied.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const IDS = Object.entries(HARDENING_BUGS_A_SPECS).flatMap(([family, specs]) =>
  specs.map((spec) => `${family}.${spec.key}`),
);

/** Each item, the bug of the reader it guards (as its reference model), and the words its failure carries. */
const PLANTED: Array<{ id: string; bug: BugA; detail: RegExp }> = [
  {
    id: 'cutting.sentence-stop-before-digit-merges',
    bug: 'digit-after-stop-splits',
    detail: /3 units|followed by the number/,
  },
  {
    id: 'cutting.list-in-quote-container',
    bug: 'list-in-quote-is-quote',
    detail: /is a block_quote, expected list_item/,
  },
  { id: 'cutting.number-stop-before-word-splits', bug: 'number-stop-always-merges', detail: /1 units/ },
  { id: 'cutting.double-backtick-code-masked', bug: 'double-backtick-code', detail: /3 units|code span/ },
  {
    id: 'ids.short-text-repeated-in-new-estate-not-moved',
    bug: 'short-move-ignores-new-repeats',
    detail: /is live again/,
  },
  {
    id: 'ids.deleted-event-counts-live-only',
    bug: 'deleted-event-counts-old-deleted',
    detail: /counted again/,
  },
  { id: 'ids.estate-key-in-id', bug: 'mint-drops-estate-key', detail: /the key is not part of the id/ },
  { id: 'ids.deleted-id-not-reminted', bug: 'ids-forget-deleted', detail: /minted a second time/ },
  { id: 're-anchoring.context-window-24', bug: 'context-window-8', detail: /the 24 code units/ },
  { id: 're-anchoring.split-needs-margin', bug: 'split-margin-dropped', detail: /2 split and 0 changed/ },
  { id: 're-anchoring.merge-needs-margin', bug: 'merge-margin-dropped', detail: /were merged/ },
  {
    id: 're-anchoring.ambiguous-claims-every-copy',
    bug: 'ambiguous-claims-first-only',
    detail: /left for another old unit/,
  },
];

async function run(id: string, seed: number, sut = ref) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    return await runItem(item(id), seed, sut);
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

afterEach(() => {
  referenceBugsA.clear();
});

describe('the seat 4 items of the cutter and the ledger', () => {
  it('are twelve, none of them catch, each with its own cause and a time cap', () => {
    expect(IDS).toHaveLength(12);
    const items = IDS.map(item);
    expect(items.filter((each) => each.role === 'catch')).toEqual([]);
    expect(new Set(items.map((each) => each.cause)).size).toBe(12);
    for (const each of items) {
      expect(each.capMs, each.id).toBeLessThanOrEqual(90_000);
      expect(each.provenance, each.id).toBe('maintainer-added');
    }
  });

  it('cover every item with a planted bug', () => {
    expect(new Set(PLANTED.map((p) => p.id))).toEqual(new Set(IDS));
  });
});

describe('each item passes on the reference reader', () => {
  for (const id of IDS) {
    it(id, async () => {
      for (const seed of [1, 2, 3, 11]) {
        const out = await run(id, seed);
        expect(out.pass, `${id} on seed ${seed}: ${out.detail}`).toBe(true);
      }
    }, 120_000);
  }
});

describe('each item fails on the reference with the planted bug it guards', () => {
  for (const { id, bug, detail } of PLANTED) {
    it(`${id} fails when the reader has the bug ${bug}`, async () => {
      for (const seed of [1, 2, 3]) {
        referenceBugsA.add(bug);
        const planted = await run(id, seed);
        referenceBugsA.clear();
        expect(planted.pass, `${id} on seed ${seed}`).toBe(false);
        expect(planted.detail, `${id} on seed ${seed}`).toMatch(detail);
      }
    }, 120_000);
  }
});

/** The reader as it is, bound in this process: the oracle of each item is its behaviour. */
const real = readerAdapter({
  ...(estate.pointer as unknown as Record<string, unknown>),
  AtomBuilder: estate.AtomBuilder,
} as unknown as ReaderExports);

describe('each item passes on the real reader', () => {
  for (const id of IDS) {
    it(id, async () => {
      for (const seed of [1, 2]) {
        const out = await run(id, seed, real);
        expect(out.pass, `${id} on seed ${seed}: ${out.detail}`).toBe(true);
      }
    }, 120_000);
  }
});
