import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_BUGS_B_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-bugs-b';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type ReferenceBugB, referenceBugsB } from './reference/bugs-b';

/**
 * The items for the planted bugs of the round 3 audit, seat 4, in radius.ts, atoms.ts, dense.ts and scan.ts. Each
 * item passes on the reference reader and fails on the reference with the one bug it guards, modelled as a switch
 * of the reference (reference/bugs-b.ts) that does what the audit's one-line replacement does to the reader.
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
  referenceBugsB.clear();
});

const ITEMS = Object.entries(HARDENING_BUGS_B_SPECS).flatMap(([family, specs]) =>
  specs.map((spec) => `${family}.${spec.key}`),
);

/** Each item with the planted bug (the audit's id) it guards and the words its failure must carry. */
const PLANTED: Array<{ id: string; bug: ReferenceBugB; audit: string; detail: RegExp }> = [
  {
    id: 'radius.new-file-reruns-whole-suite',
    bug: 'file-unknown-skipped',
    audit: 'w-radius-file-unknown-skipped',
    detail: /not the whole suite/,
  },
  {
    id: 'radius.whole-reason-names-first-new-unit',
    bug: 'whole-reason-last-wins',
    audit: 'radius-whole-reason-last-wins',
    detail: /a later unit of .*must name the first new unit/,
  },
  {
    id: 'radius.deleted-before-not-deleted-again',
    bug: 'old-deleted-reported',
    audit: 'r2-radius-old-deleted-reported',
    detail: /deleted by the earlier edit is classed deleted/,
  },
  {
    id: 'radius.new-unit-reruns-its-own-section',
    bug: 'section-skips-own-heading',
    audit: 'r2-radius-section-skips-own-heading',
    detail: /expected the 3 old units under the heading/,
  },
  {
    id: 'radius.new-unit-under-empty-heading-falls-back',
    bug: 'section-stops-at-empty',
    audit: 'r2-radius-section-stops-at-empty',
    detail: /holds 0 units, expected the 4 old units/,
  },
  {
    id: 'radius.manifest-condition-unit-reruns-its-atom',
    bug: 'condition-units-not-mapped',
    audit: 'radius-condition-units-not-mapped',
    detail: /"kind":"unit".*expected only the prompt change/,
  },
  {
    id: 'radius.manifest-unit-changes-in-id-order',
    bug: 'manifest-unsorted',
    audit: 'radius-manifest-unsorted',
    detail: /\(id order\)/,
  },
  {
    id: 'grouping.title-ninety-characters',
    bug: 'title-91',
    audit: 'atoms-title-91',
    detail: /characters\), expected .*\(\d+\)/,
  },
  {
    id: 'grouping.orphan-condition-refused',
    bug: 'orphan-condition-unreported',
    audit: 'atoms-orphan-condition-unreported',
    detail: /nothing reports the condition/,
  },
  {
    id: 'grouping.none-link-builds-no-refusal',
    bug: 'none-link-refused',
    audit: 'r2-atoms-none-link-refused',
    detail: /a link to none is reported/,
  },
  {
    id: 'grouping.template-placeholder-unfilled-refused',
    bug: 'partial-template',
    audit: 'r2-atoms-partial-template',
    detail: /a unit with no code span built an atom whose situation is "Before {2}runs"/,
  },
  {
    id: 'grouping.when-file-needs-a-file',
    bug: 'whenfile-ignores-exists',
    audit: 'r2-atoms-whenfile-ignores-exists',
    detail: /a whenFile mapping built 1 atom/,
  },
  {
    id: 'labels.haiku-retry-says-why',
    bug: 'retry-note-never',
    audit: 'r2-dense-retry-note-never',
    detail: /the retried request is the first one again/,
  },
  {
    id: 'labels.carried-window-not-asked-again',
    bug: 'carried-window-requested',
    audit: 'r2-scan-carried-window-requested',
    detail: /the rescan sent 2 requests/,
  },
  {
    id: 'labels.link-candidates-of-its-kind',
    bug: 'candidates-any-kind',
    audit: 'r2-scan-candidates-any-kind',
    detail: /lists hazard\..*a kind the link kind does not name/,
  },
  {
    id: 'labels.link-candidates-in-id-order',
    bug: 'candidates-unsorted',
    audit: 'r2-scan-candidates-unsorted',
    detail: /expected id order/,
  },
];

describe('the seat 4 bug items (lane B) pass on the reference reader', () => {
  for (const id of ITEMS) {
    it(id, async () => {
      expect(await run(id), id).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each seat 4 bug item (lane B) fails on the reference with its planted bug', () => {
  for (const { id, bug, audit, detail } of PLANTED) {
    it(`${id} fails when the reader has the bug ${audit}`, async () => {
      referenceBugsB.add(bug);
      const planted = await run(id);
      expect(planted.pass, `${id}: ${planted.detail}`).toBe(false);
      expect(planted.detail, id).toMatch(detail);
    }, 120_000);
  }

  it('covers every item of the file with a planted bug, and each bug with one item', () => {
    expect(new Set(PLANTED.map((p) => p.id))).toEqual(new Set(ITEMS));
    expect(new Set(PLANTED.map((p) => p.bug)).size).toBe(PLANTED.length);
  });

  it('keeps each item off the catch role and under 90 s', () => {
    for (const id of ITEMS) {
      expect(item(id).role, id).toBeUndefined();
      expect(item(id).capMs, id).toBeLessThanOrEqual(90_000);
    }
  });
});
