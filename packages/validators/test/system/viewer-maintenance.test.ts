import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { breaker2Items } from '../../src/ladders/system/bank/claims/breaker2';
import { PASS, scratchFolder } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ids = [
  'label-file-shape',
  'labelled-by-default-and-flag',
  'relabel-replaces',
  'label-write-requires-token-and-origin',
];

describe('viewer label contracts through the page form', () => {
  for (const seed of [1, 2, 3]) {
    for (const slug of ids) {
      it(`${slug}, seed ${seed}`, async () => {
        const scratch = scratchFolder();
        const signals = ['SIGINT', 'SIGTERM'] as const;
        const listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
        try {
          const item = breaker2Items().find((entry) => entry.id === `breaker2/viewer/${slug}`);
          expect(item).toBeDefined();
          await expect(item?.check({ seed, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
        } finally {
          // The in-process CLI installs stop handlers. Keep each item isolated from later tests.
          for (const signal of signals) {
            for (const listener of process.listeners(signal)) {
              if (!listeners.get(signal)?.has(listener)) process.removeListener(signal, listener);
            }
          }
          scratch.remove();
        }
      }, 1_800_000);
    }
  }
});
