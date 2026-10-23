import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FrameError, isolate } from '../../src/frame';

/**
 * A run the relay killed and that has not ended when the relay's wait runs out is named in a FrameError at close,
 * never left silent (review of PR 1456, sonnet-review-c-2: no test took that path). The wait is set to 0 ms, so no
 * run can end within it.
 */
const PRODUCT = fileURLToPath(new URL('./fixtures/cheats.ts', import.meta.url));

it('names the runs that did not end within the wait, in a FrameError at close', () => {
  const frame = isolate<{ honest: (xs: number[]) => number }>({
    module: PRODUCT,
    seed: 9,
    tag: 'reap-error',
    reapMs: 0,
  });
  expect(frame.product.honest([1, 2, 3])).toBe(4);
  let thrown: unknown;
  try {
    frame.close();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FrameError);
  expect(String((thrown as Error).message)).toMatch(/run [ABD](, [ABD])* did not end within 0 s of its kill/);
}, 120_000);
