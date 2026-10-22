import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { PointerSut, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';

/**
 * PR 1136, codex finding 1: the replay items that check a cassette miss read the STRUCTURED miss of the scan
 * result (`miss.differs`, `miss.nearest`, `miss.labeler`, `miss.key`), never the words of the error message.
 * Three kinds of reader prove it. A reader whose message is wordless but whose fields are right still passes
 * every item (the old items failed it). A reader whose message is right but whose fields are missing or wrong
 * fails the item that reads them (the old items passed it). Each is a wrapper of the reference reader.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
async function run(id: string, sut: PointerSut, seed = 1) {
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
const mutant = (
  name: string,
  scan: (request: ScanRequest) => ReturnType<PointerSut['scan']>,
): PointerSut => ({ ...ref, name, scan });

/** The right fields, a message with none of the words an item once looked for. */
const wordless = (): PointerSut =>
  mutant('miss-wordless', async (request) => {
    const out = await ref.scan(request);
    return out.miss ? { ...out, error: 'the cassette has no answer' } : out;
  });
/** The right words, no structured miss. */
const fieldless = (): PointerSut =>
  mutant('miss-fieldless', async (request) => {
    const { miss: _miss, ...rest } = await ref.scan(request);
    return rest;
  });
/** The right words, a miss whose fields differ list is empty. */
const noDiffers = (): PointerSut =>
  mutant('miss-no-differs', async (request) => {
    const out = await ref.scan(request);
    return out.miss ? { ...out, miss: { ...out.miss, differs: [] } } : out;
  });
/** The right words, the labeler id of another labeler. */
const otherLabeler = (): PointerSut =>
  mutant('miss-other-labeler', async (request) => {
    const out = await ref.scan(request);
    return out.miss ? { ...out, miss: { ...out.miss, labeler: 'another-labeler' } } : out;
  });
/** The right words, a nearest entry that is no recorded entry (or none for a miss that names one). */
const otherNearest = (): PointerSut =>
  mutant('miss-other-nearest', async (request) => {
    const out = await ref.scan(request);
    return out.miss ? { ...out, miss: { ...out.miss, nearest: 'no-such-entry' } } : out;
  });

/** Items that read the miss and nothing of its message. */
const FIELD_ITEMS = [
  'replay.fixture-haiku-replays-committed',
  'replay.fixture-jev-replays-committed',
  'replay.fixture-jev-unit-replays-committed',
  'replay.fixture-replay-twice-identical',
  'replay.fixture-miss-names-model',
  'replay.fixture-miss-names-prompt-version',
  'replay.fixture-miss-names-schema-version',
  'replay.fixture-miss-names-set-hash',
  'replay.fixture-miss-names-labeler',
  'replay.fixture-miss-names-system-part',
  'replay.fixture-miss-names-questions-part',
  'replay.fixture-miss-names-cut-digest',
  'replay.cut-digest-mismatch-names-versions',
  'replay.miss-names-description-edit',
  'replay.miss-names-renamed-label',
  'replay.miss-names-added-example',
  'replay.miss-names-changed-unit',
  'replay.miss-names-new-file',
  'replay.miss-names-cut-digest',
  'replay.miss-names-labeler',
  'replay.miss-names-set-name',
  'replay.miss-names-nearest-entry',
  'replay.fresh-replay-needs-all-entries',
  'replay.one-cassette-per-arm',
  'replay.miss-nearest-same-labeler',
  'replay.miss-names-least-different-entry',
];

/** What each item says when its fields are missing: the words of its own failure, never the reader's. */
const MISSING: Array<[string, RegExp]> = [
  ['replay.fixture-haiku-replays-committed', /carries no structured cassette miss/],
  ['replay.fixture-miss-names-set-hash', /carries no structured cassette miss/],
  ['replay.miss-names-description-edit', /carries no structured cassette miss/],
  ['replay.miss-names-new-file', /carries no structured cassette miss/],
  ['replay.miss-names-set-name', /carries no structured cassette miss/],
  ['replay.miss-names-labeler', /does not name the labeler id .*no structured miss/],
  ['replay.miss-names-nearest-entry', /nearest window missing/],
  ['replay.fresh-replay-needs-all-entries', /fresh replay did not reject missing entry/],
  ['replay.one-cassette-per-arm', /wrong arm accepted or unnamed/],
  ['replay.miss-nearest-same-labeler', /names no setHash/],
  ['replay.miss-names-least-different-entry', /does not name the set hash/],
];

describe('the items that read a cassette miss read its fields, not its message', () => {
  it('every one passes on the reference reader, on two seeds', async () => {
    for (const id of FIELD_ITEMS) {
      for (const seed of [1, 2]) {
        const out = await run(id, ref, seed);
        expect(out, `${id} seed ${seed}`).toMatchObject({ pass: true });
      }
    }
  }, 900_000);

  it('every one but the two that read a Node and ICU version passes a reader whose message is wordless', async () => {
    // The versions of the cutter have no field of the miss: those two read them in the message.
    const reads = new Set([
      'replay.fixture-miss-names-cut-digest',
      'replay.cut-digest-mismatch-names-versions',
    ]);
    for (const id of FIELD_ITEMS.filter((x) => !reads.has(x)))
      expect(await run(id, wordless()), id).toMatchObject({ pass: true });
  }, 900_000);

  for (const [id, words] of MISSING)
    it(`${id} fails a reader whose message is right and whose miss has no fields`, async () => {
      const out = await run(id, fieldless());
      expect(out.pass, id).toBe(false);
      expect(out.detail, id).toMatch(words);
    }, 120_000);

  it('an item that reads differs fails a miss whose differs is empty', async () => {
    for (const [id, words] of [
      ['replay.fixture-miss-names-set-hash', /the miss differs in \[\], not in setHash/],
      ['replay.miss-names-description-edit', /the miss differs in \[\], in none of setHash, part.user/],
      ['replay.miss-names-least-different-entry', /does not name the set hash/],
    ] as const) {
      const out = await run(id, noDiffers());
      expect(out.pass, id).toBe(false);
      expect(out.detail, id).toMatch(words);
    }
  }, 300_000);

  it('the items that read the labeler id fail a miss that carries the id of another labeler', async () => {
    for (const [id, words] of [
      ['replay.miss-names-labeler', /does not name the labeler id/],
      ['replay.one-cassette-per-arm', /wrong arm accepted or unnamed/],
      ['replay.miss-names-new-file', /carries the labeler id another-labeler/],
      ['replay.miss-names-set-name', /carries the labeler id another-labeler/],
    ] as const) {
      const out = await run(id, otherLabeler());
      expect(out.pass, id).toBe(false);
      expect(out.detail, id).toMatch(words);
    }
  }, 300_000);

  it('the items that read the nearest entry fail a miss that names another', async () => {
    for (const [id, words] of [
      ['replay.miss-names-nearest-entry', /nearest window missing/],
      ['replay.miss-names-new-file', /the miss names a nearest entry/],
      ['replay.fresh-replay-needs-all-entries', /fresh replay did not reject missing entry/],
    ] as const) {
      const out = await run(id, otherNearest());
      expect(out.pass, id).toBe(false);
      expect(out.detail, id).toMatch(words);
    }
  }, 300_000);
});
