import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PointerSut, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { tally } from './helpers';
import { referenceSut } from './reference/index';

const LEAKY = fileURLToPath(new URL('./leaky-key.ts', import.meta.url));
const HAIKU_ITEMS = [
  'labels.haiku-dense-request',
  'labels.haiku-thinking-block-first',
  'labels.haiku-stop-reason-refused',
  'labels.haiku-refuse-wrong-window-or-set',
];
const FAILED = 'replay.failed-recording-keeps-valid-cassette';
const KEY = 'privacy.model-key-never-in-outputs';
const only = (ids: string[]) => (item: { id: string }) => ids.includes(item.id);

/**
 * The system 2 items count requests as windows times runs (the product asks every window for five runs), the failed
 * recording keeps a valid cassette whether the scan fails or reports a failed window, and the model-key item gives
 * the Jev arm a set it can label alone. Both directions: the honest reference passes, a planted fault fails.
 */
describe('run counts, failed recordings and the model key', { timeout: 600_000 }, () => {
  it('the honest reference passes all six items', async () => {
    const out = await tally(referenceSut(), only([...HAIKU_ITEMS, FAILED, KEY]));
    expect(out.total).toBe(6);
    expect(out.failed).toEqual([]);
  });

  it('a reference that asks one run per window fails the four request-count items and the failed recording', async () => {
    const out = await tally(referenceSut({ fault: 'one-run' }), only([...HAIKU_ITEMS, FAILED]));
    expect(out.failed.map((f) => f.id).sort()).toEqual([...HAIKU_ITEMS, FAILED].sort());
  });

  it('a scan that leaves a torn line in the cassette of a failed run fails the failed recording', async () => {
    const ref = referenceSut();
    const torn: PointerSut = {
      ...ref,
      name: 'torn',
      scan: async (request: ScanRequest) => {
        const out = await ref.scan(request);
        return out.ok ? out : { ...out, cassette: `${out.cassette ?? ''}{"key":"` };
      },
    };
    const out = await tally(torn, only([FAILED]));
    expect(out.failed.map((f) => f.id)).toEqual([FAILED]);
  });

  it('a scan that records the failed window or hides the failure fails the failed recording', async () => {
    const ref = referenceSut();
    const silent: PointerSut = {
      ...ref,
      name: 'silent',
      scan: async (request: ScanRequest) => {
        const out = await ref.scan(request);
        return { ...out, ok: true, diagnostics: [] };
      },
    };
    const out = await tally(silent, only([FAILED]));
    expect(out.failed.map((f) => f.id)).toEqual([FAILED]);
  });

  it('a reader that prints the key only on the Jev arm fails the model-key item', async () => {
    const out = await tally(referenceSut(), only([KEY]), 1, LEAKY);
    expect(out.failed.map((f) => f.id)).toEqual([KEY]);
  });
});
