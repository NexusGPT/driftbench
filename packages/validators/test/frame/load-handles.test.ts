import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import type * as product from './fixtures/load-handles';

/**
 * A correct product that exports a value holding functions, and returns results that hold functions, answers alike
 * in every run (review of PR 986, sonnet-review-c-2, ci 39998442084). The twins of runs A and B encode the exported
 * value when the module loads, which gives its functions handles; run D's wrapper exports no value and run C encodes
 * none. Handles given at load put the handle numbers of every later answer out of step, and the frame reported a
 * divergence and a taint where nothing differed.
 */

const PRODUCT = fileURLToPath(new URL('./fixtures/load-handles.ts', import.meta.url));

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

it('answers alike in every run when the module exports a value holding functions', () => {
  const frame = isolate<typeof product>({ module: PRODUCT, seed: 21, plain: true });
  open.push(frame as Frame<unknown>);
  expect(frame.product.counter(1).n).toBe(1);
  expect(frame.product.counter(2).n).toBe(2);
  expect(frame.divergence()).toBeUndefined();
  expect(frame.tainted()).toBeUndefined();
}, 120_000);
