import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem, stopItemChild } from '../../src/ladders/pointer/bank/run';
import type { Outcome, PointerItem } from '../../src/ladders/pointer/bank/types';
import type { Diagnostic, PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';

/**
 * PR 1136, the conversion from the words of a message to codes weakened two items. An item that read a code
 * now keeps every condition it had and adds the code check beside it. Each reader here is a wrapper of the
 * reference reader with one defect that an old check caught and a check on the code alone does not.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string): PointerItem => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

afterEach(async () => {
  await stopItemChild();
  clearSeedFreeCache();
  delete process.env.DRIFTBENCH_POINTER_SUT;
});

async function run(id: string, sut: PointerSut, seed = 1): Promise<Outcome> {
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  return runItem(item(id), seed, sut);
}

const scanning = (name: string, change: (out: ScanResult) => ScanResult): PointerSut => ({
  ...ref,
  name,
  scan: async (request) => change(await ref.scan(request)),
});

const VECTOR = 'labels.vector-sum-103-refused';
const WARNING_ITEMS = ['replay.model-mismatch-warns', 'privacy.warning-names-models-not-units'];

describe('labels.vector-sum-103-refused keeps the class of the diagnostic and its cause', () => {
  it('the reference reader passes on two seeds', async () => {
    for (const seed of [1, 2])
      expect(await run(VECTOR, ref, seed), `seed ${seed}`).toMatchObject({ pass: true });
  }, 120_000);

  it('a no-vector cause under the class duplicate fails', async () => {
    const wrongClass = scanning('wrong-class', (out) => ({
      ...out,
      diagnostics: out.diagnostics.map(
        (d): Diagnostic => (d.reason === 'no-vector' ? { ...d, code: 'duplicate' } : d),
      ),
    }));
    expect((await run(VECTOR, wrongClass)).pass).toBe(false);
  }, 120_000);

  it('the class refusal under another cause fails', async () => {
    const wrongCause = scanning('wrong-cause', (out) => ({
      ...out,
      diagnostics: out.diagnostics.map(
        (d): Diagnostic => (d.reason === 'no-vector' ? { ...d, reason: 'another-cause' } : d),
      ),
    }));
    expect((await run(VECTOR, wrongCause)).pass).toBe(false);
  }, 120_000);
});

describe('the model-mismatch items keep the text list beside the records', () => {
  for (const id of WARNING_ITEMS) {
    it(`${id}: the reference reader passes`, async () => {
      expect(await run(id, ref)).toMatchObject({ pass: true });
    }, 120_000);

    it(`${id}: a spurious warning text with matching models fails`, async () => {
      const spurious = scanning('spurious-warning', (out) =>
        out.warningRecords?.length === 0
          ? { ...out, warnings: [...(out.warnings ?? []), 'spurious warning'] }
          : out,
      );
      expect((await run(id, spurious)).pass).toBe(false);
    }, 120_000);

    it(`${id}: a record of the mismatch with no warning text fails`, async () => {
      const recordsOnly = scanning('records-without-text', (out) =>
        (out.warningRecords?.length ?? 0) > 0 ? { ...out, warnings: [] } : out,
      );
      expect((await run(id, recordsOnly)).pass).toBe(false);
    }, 120_000);

    it(`${id}: a spurious record with matching models fails`, async () => {
      const spuriousRecord = scanning('spurious-record', (out) =>
        out.warningRecords?.length === 0
          ? { ...out, warningRecords: [{ code: 'model-mismatch', recorded: 'a-model', returned: 'b-model' }] }
          : out,
      );
      expect((await run(id, spuriousRecord)).pass).toBe(false);
    }, 120_000);
  }
});
