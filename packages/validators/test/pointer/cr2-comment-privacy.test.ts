import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_PRIVACY_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-privacy';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugPrivacy, referenceBugsPrivacy } from './reference/bugs-privacy';

/**
 * The four comment privacy items (`specs/hardening-privacy.ts`): no comment text reaches a labeler request,
 * whether the comment sits inside a sentence, at the end of a line after text, in a heading or in a table cell.
 * Each item passes on the reference reader, on two seeds, and fails on a reference that sends the comment text
 * (the reader before the rule) and on one that drops the whole unit that holds the comment (the rest of the
 * unit must be sent). The mutants are modelled in `reference/bugs-privacy.ts`.
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
  referenceBugsPrivacy.clear();
});

const CANDIDATE = 'privacy.comment-text-never-leaves-link-candidate';

const ITEMS = Object.entries(HARDENING_PRIVACY_SPECS).flatMap(([family, specs]) =>
  specs.map((spec) => `${family}.${spec.key}`),
);

/** The four placements of a comment in a unit; the fifth item is about a link candidate, tested below. */
const PLACED = ITEMS.filter((id) => id !== CANDIDATE);

const MUTANTS: Array<{ bug: BugPrivacy; detail: RegExp }> = [
  { bug: 'comment-text-sent', detail: /the text of a comment reached a request/ },
  { bug: 'comment-unit-dropped', detail: /the text around the comment is in no request/ },
];

describe('the comment privacy items pass on the reference reader', () => {
  for (const id of ITEMS) {
    it(id, async () => {
      for (const seed of [1, 2, 3])
        expect(await run(id, seed), `${id} seed ${seed}`).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each comment privacy item fails on a reference that breaks the rule', () => {
  for (const id of PLACED) {
    for (const { bug, detail } of MUTANTS) {
      it(`${id} fails when the reader has the defect ${bug}`, async () => {
        referenceBugsPrivacy.add(bug);
        const planted = await run(id);
        expect(planted.pass, id).toBe(false);
        expect(planted.detail, id).toMatch(detail);
      }, 120_000);
    }
  }

  it('holds the five items, each with its own cause tag, none a catch item', () => {
    expect(ITEMS).toHaveLength(5);
    const specs = HARDENING_PRIVACY_SPECS.privacy ?? [];
    expect(specs.map((spec) => spec.cause).sort()).toEqual([
      'privacy:comment-text-never-leaves-eol',
      'privacy:comment-text-never-leaves-heading',
      'privacy:comment-text-never-leaves-inline',
      'privacy:comment-text-never-leaves-link-candidate',
      'privacy:comment-text-never-leaves-table',
    ]);
    expect(specs.every((spec) => spec.role === undefined && (spec.capMs ?? 0) <= 90_000)).toBe(true);
  });
});

const LEAKED_CANDIDATE = /the text of a comment reached a request as a link candidate/;
const NO_CANDIDATE = /the request for the second file lists no candidate/;

describe('the link candidate item (a comment in the unit of an atom the scan lists as a candidate)', () => {
  it('is red on a reference that lists the atom as it is given', async () => {
    referenceBugsPrivacy.add('candidate-comment-sent');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(LEAKED_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reference that lists no candidate', async () => {
    referenceBugsPrivacy.add('candidates-all-withheld');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reference that sends every comment as written', async () => {
    referenceBugsPrivacy.add('comment-text-sent');
    const planted = await run(CANDIDATE);
    expect(planted.pass).toBe(false);
    expect(planted.detail).toMatch(/reached a request/);
  }, 120_000);
});
