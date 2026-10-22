import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, executeHere, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_BUGS_C_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-bugs-c';
import { loadReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugC, bugsC } from './reference/bugs-c';

/**
 * The items of lane bugs C (round 3 audit, seat 4: answer validation, spans, links, runs, carry, the system 1
 * clients and the settings file). Each item passes on the reference reader and fails on the reference with the
 * effect of one planted bug of the audit. On GitHub the probe also runs them on the real reader, unmutated and
 * with each bug's one-line patch applied (CR2_REAL=1, CR2_BUG=<audit id>).
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
const IDS = (HARDENING_BUGS_C_SPECS.labels ?? []).map((spec) => `labels.${spec.key}`);
const SEEDS = [1, 2, 3];

async function run(id: string, seed: number) {
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
  bugsC.clear();
});

/** Each planted bug: its id in the audit's patch list, its effect on the reference, the item it turns red. */
const PLANTED: Array<{ audit: string; bug: BugC; id: string; detail: RegExp }> = [
  {
    audit: 'labels-descending-range-silent',
    bug: 'descending-range-silent',
    id: 'labels.refuse-descending-range-explicit',
    detail: /no refusal names the backwards range/,
  },
  {
    audit: 'labels-double-label-accepted',
    bug: 'double-label-accepted',
    id: 'labels.unit-named-twice-refused',
    detail: /from a second entry/,
  },
  {
    audit: 'w-labels-unit-outside-window',
    bug: 'unit-outside-window',
    id: 'labels.range-leaving-window-refused',
    detail: /runs past the window/,
  },
  {
    audit: 'labels-null-target-accepted',
    bug: 'null-target-kept',
    id: 'labels.null-target-is-no-target',
    detail: /holds undefined, expected/,
  },
  {
    audit: 'labels-two-fences-first-wins',
    bug: 'two-fences-first-wins',
    id: 'labels.two-fences-no-answer',
    detail: /two fenced objects/,
  },
  {
    audit: 'labels-span-text-twice-accepted',
    bug: 'span-text-twice-accepted',
    id: 'labels.span-text-twice-refused',
    detail: /is in it twice/,
  },
  {
    audit: 'labels-adjacent-spans-overlap',
    bug: 'adjacent-spans-overlap',
    id: 'labels.adjacent-spans-do-not-overlap',
    detail: /only touch do not overlap/,
  },
  {
    audit: 'labels-nested-span-may-overrun-parent',
    bug: 'nested-span-overrun',
    id: 'labels.nested-span-inside-parent',
    detail: /runs past the action span/,
  },
  {
    audit: 'labels-case-fold-length-guard',
    bug: 'case-fold-no-length-guard',
    id: 'labels.span-text-case-fold-changes-length-refused',
    detail: /lower case is longer/,
  },
  {
    audit: 'labels-link-kind-twice',
    bug: 'link-kind-twice',
    id: 'labels.link-kind-twice-refused',
    detail: /links the kind tool twice/,
  },
  {
    audit: 'labels-link-unlisted-atom',
    bug: 'link-unlisted',
    id: 'labels.link-unlisted-value-refused',
    detail: /which the request did not list/,
  },
  {
    audit: 'labels-vector-tolerance-5',
    bug: 'vector-tolerance-5',
    id: 'labels.vector-sum-103-refused',
    detail: /no vector/,
  },
  {
    audit: 'yesno-vector-unchecked',
    bug: 'vector-unchecked',
    id: 'labels.vector-sum-103-refused',
    detail: /no vector/,
  },
  {
    audit: 'labels-choice-tie-last-wins',
    bug: 'choice-tie-last-wins',
    id: 'labels.choice-tie-first-wins',
    detail: /a tie gives/,
  },
  {
    audit: 'w-yesno-threshold-inverted',
    bug: 'threshold-inverted',
    id: 'labels.decisions-below-threshold-none',
    detail: /at 0\.4/,
  },
  {
    audit: 'yesno-link-labels-asked',
    bug: 'link-labels-asked',
    id: 'labels.system1-refuses-link-labels',
    detail: /carries links/,
  },
  {
    audit: 'settings-nan-threshold',
    bug: 'nan-threshold',
    id: 'labels.settings-threshold-nan-refused',
    detail: /not a number is no threshold/,
  },
  {
    audit: 'labels-runs-ignore-target-disagreement',
    bug: 'runs-ignore-target',
    id: 'labels.runs-differ-on-target-no-opinion',
    detail: /runs named two targets/,
  },
  {
    audit: 'labels-carry-ignores-labeler-hash',
    bug: 'carry-ignores-labeler',
    id: 'labels.labeler-change-relabels-all',
    detail: /sent no call/,
  },
  {
    audit: 'labels-user-probability-above-one',
    bug: 'user-probability-above-one',
    id: 'labels.user-probability-above-one-dropped',
    detail: /a probability above 1 is no answer/,
  },
];

describe('the bugs C items pass on the reference reader', () => {
  for (const id of IDS) {
    it(id, async () => {
      for (const seed of SEEDS) {
        const out = await run(id, seed);
        expect(out.pass, `${id} seed ${seed}: ${out.detail}`).toBe(true);
      }
    }, 300_000);
  }
});

describe('each bugs C item fails on the reference with the effect of its planted bug', () => {
  for (const { audit, bug, id, detail } of PLANTED) {
    it(`${id} fails with ${audit}`, async () => {
      bugsC.add(bug);
      for (const seed of SEEDS) {
        const out = await run(id, seed);
        expect(out.pass, `${id} stayed green with ${bug} on seed ${seed}`).toBe(false);
        expect(out.detail, `${id} seed ${seed}`).toMatch(detail);
      }
    }, 300_000);
  }

  it('covers every item, and the twenty bugs of the lane', () => {
    expect(new Set(PLANTED.map((p) => p.id))).toEqual(new Set(IDS));
    expect(new Set(PLANTED.map((p) => p.audit)).size).toBe(20);
    expect(IDS.every((id) => item(id).role === undefined)).toBe(true);
  });
});

/** Set on GitHub only: the real reader, and the audit id of the bug whose patch the probe applied to it. */
const REAL = process.env.CR2_REAL === '1';
const AUDIT_BUG = process.env.CR2_BUG ?? '';

describe.skipIf(!REAL)('the bugs C items on the real reader', () => {
  it(AUDIT_BUG ? `lose the items of ${AUDIT_BUG}` : 'pass every item unmutated', async () => {
    const reader = await loadReaderExports(
      async () => (await import('@agent-nexus/driftbench-estate')) as unknown as Record<string, unknown>,
      60_000,
    );
    const sut = readerAdapter(reader);
    const red = new Set(PLANTED.filter((p) => p.audit === AUDIT_BUG).map((p) => p.id));
    if (AUDIT_BUG) expect(red.size, `no item maps to ${AUDIT_BUG}`).toBeGreaterThan(0);
    const results: Array<{ id: string; seed: number; pass: boolean; detail: string }> = [];
    for (const seed of SEEDS) {
      for (const id of IDS) {
        clearSeedFreeCache();
        const out = await executeHere(item(id), seed, sut);
        results.push({ id, seed, pass: out.pass, detail: out.detail.slice(0, 300) });
      }
    }
    console.log(`CR2_RESULTS ${JSON.stringify({ bug: AUDIT_BUG || 'none', results })}`);
    for (const result of results) {
      const where = `${result.id} seed ${result.seed}: ${result.detail}`;
      if (red.has(result.id)) expect(result.pass, where).toBe(false);
      else if (!AUDIT_BUG) expect(result.pass, where).toBe(true);
    }
  }, 1_200_000);
});
