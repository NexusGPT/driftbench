import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { reanchoring } from '../../src/ladders/pointer/bank/specs/reanchoring';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { alwaysWarn, cheatA, cheatC, narrowLineage } from './cr2-cheats';
import { referenceSut } from './reference/index';

/**
 * Red-first proofs of the round 3 cheater repairs (audit-pointer-r3-2, seat 2). Each changed item passes on
 * the reference reader and fails on the reference reader with the effect of a cheat of the audit: variant c
 * (a constant `unchanged`, a constant lineage, empty warnings), variant a (events from a same-path,
 * same-fingerprint compare, a lineage that steps only on a changed fingerprint or a deletion, a warning
 * literal that names m-1 and m-2), and a reader that warns on every scan. Where the cheat gained the item on
 * the head the audit measured, the failure must come from the check this repair added.
 */

const ref = referenceSut();
const bank = pointerBank();
const REFERENCE = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
const CHEAT_C = fileURLToPath(new URL('./cr2-cheats.ts', import.meta.url));
const CHEAT_A = fileURLToPath(new URL('./cr2-cheat-a.ts', import.meta.url));

/** The items variant c gained on the measured head (verdict, gains of c). */
const C_GAINS = new Set([
  'adversarial.swap-texts-in-place',
  'adversarial.swap-with-similar-neighbour',
  'ids.ledger-status-live',
  'labels.anchoring-independent-of-labeler',
  'privacy.error-messages-quote-no-unit-text',
  're-anchoring.blank-lines',
  're-anchoring.bullet-swap',
  're-anchoring.copy-keeps-original',
  're-anchoring.crlf-conversion',
  're-anchoring.directory-rename',
  're-anchoring.file-rename',
  're-anchoring.heading-rename-keeps-units',
  're-anchoring.move-ambiguous-two-targets',
  're-anchoring.move-swap-two',
  're-anchoring.noop',
  're-anchoring.paragraph-break-between-sentences',
  're-anchoring.renumber',
  're-anchoring.rewrap',
]);

/** The items variant a gained on the measured head, besides those of c (run 39615487701). */
const A_GAINS = new Set([
  ...C_GAINS,
  'adversarial.edit-inside-duplicates',
  'ids.lineage-is-history',
  'privacy.warning-names-models-not-units',
  're-anchoring.delete-file',
  're-anchoring.delete-one',
  're-anchoring.delete-section',
  're-anchoring.events-follow-the-text',
  're-anchoring.move-across-files',
  're-anchoring.move-and-reword',
  're-anchoring.replace-whole-file',
  're-anchoring.reword-append-clause',
  're-anchoring.reword-case-flip-word',
  're-anchoring.reword-front-matter-value',
  're-anchoring.reword-heading',
  're-anchoring.reword-list-item',
  're-anchoring.reword-moderate',
  're-anchoring.reword-negation',
  're-anchoring.reword-number',
  're-anchoring.reword-one-word',
  're-anchoring.reword-prepend-clause',
  're-anchoring.reword-quote-paragraph',
  're-anchoring.reword-sweep-monotone',
  're-anchoring.reword-table-cell',
  're-anchoring.reword-two-words',
  're-anchoring.rewrite-heading',
  're-anchoring.rewrite-list-item',
  're-anchoring.rewrite-sentence',
  're-anchoring.rewrite-similar-to-neighbour',
  're-anchoring.rewrite-table-cell',
  're-anchoring.rewrite-ten-in-a-row',
  're-anchoring.twin-delete-is-not-a-move',
  'replay.model-mismatch-warns',
]);

/** The items that run the twin edit: re-anchoring rows but two, a hardening row, three adversarial rows. */
const NO_TWIN = new Set(['duplicate-section-insert', 'no-wrong-anchors-fuzz']);
const twinRows = reanchoring.specs.filter((spec) => !NO_TWIN.has(spec.key));
const TWIN_ITEMS = [
  ...twinRows.map((spec) => `re-anchoring.${spec.key}`),
  're-anchoring.events-follow-the-text',
  'adversarial.swap-texts-in-place',
  'adversarial.swap-with-similar-neighbour',
  'adversarial.edit-inside-duplicates',
];
const TWIN = /the twin edit/;

const item = (id: string) => {
  const found = bank.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

/** Runs one item; `child` names the module a child process of the item loads. */
async function outcome(id: string, sut: PointerSut, child = REFERENCE) {
  process.env.DRIFTBENCH_POINTER_SUT = child;
  clearSeedFreeCache();
  return runItem(item(id), 1, sut);
}

async function green(id: string): Promise<void> {
  const out = await outcome(id, ref);
  expect(out.pass, `${id} on the reference: ${out.detail}`).toBe(true);
}

async function red(id: string, sut: PointerSut, reason?: RegExp, child?: string): Promise<void> {
  const out = await outcome(id, sut, child);
  expect(out.pass, `${id} stayed green on ${sut.name}`).toBe(false);
  if (reason) expect(out.detail, `${id} on ${sut.name}`).toMatch(reason);
}

afterEach(() => {
  delete process.env.DRIFTBENCH_POINTER_SUT;
  clearSeedFreeCache();
});

describe('proposals 1 and 5: the twin edit of every events item', () => {
  // `group <n>` splits the items over four CI jobs (`-t "group <n>:"`).
  for (const [at, id] of TWIN_ITEMS.entries()) {
    it(`group ${at % 4}: ${id} is green on the reference, red on a constant and on a compare`, async () => {
      await green(id);
      await red(id, cheatC, C_GAINS.has(id) ? TWIN : undefined);
      await red(id, cheatA, A_GAINS.has(id) ? TWIN : undefined);
    }, 240_000);
  }
});

describe('proposal 2 and the lineage items', () => {
  it('ids.ledger-status-live needs a second lineage step after an edit', async () => {
    await green('ids.ledger-status-live');
    await red('ids.ledger-status-live', cheatC, /not one more step/);
    await red('ids.ledger-status-live', cheatA, /moved unit has the lineage .*not one more step/);
  }, 120_000);

  it('ids.lineage-is-history needs a moved step', async () => {
    await green('ids.lineage-is-history');
    await red('ids.lineage-is-history', cheatC);
    await red('ids.lineage-is-history', cheatA);
    await red('ids.lineage-is-history', narrowLineage, /moved unit has the lineage/);
  }, 120_000);
});

describe('proposal 3: seeded model names and a case without a mismatch', () => {
  for (const id of ['privacy.warning-names-models-not-units', 'replay.model-mismatch-warns']) {
    it(`${id}: a literal, an empty list and an always-warn reader fail`, async () => {
      await green(id);
      await red(id, cheatC);
      await red(id, cheatA, /no warning names both models|returned-model warning missing/);
      await red(id, alwaysWarn, /models agree warns/);
    }, 120_000);
  }
});

describe('proposal 4: a field that must not be empty', () => {
  it('labels.anchoring-independent-of-labeler needs the events of the script', async () => {
    await green('labels.anchoring-independent-of-labeler');
    await red('labels.anchoring-independent-of-labeler', cheatC, /expected event/);
    await red('labels.anchoring-independent-of-labeler', cheatA, /expected event/);
  }, 240_000);

  it('privacy.error-messages-quote-no-unit-text needs a warning when the model changes', async () => {
    await green('privacy.error-messages-quote-no-unit-text');
    await red('privacy.error-messages-quote-no-unit-text', cheatC, /left the warnings empty/, CHEAT_C);
    await red('privacy.error-messages-quote-no-unit-text', cheatA, /left the warnings empty/, CHEAT_A);
  }, 240_000);
});
