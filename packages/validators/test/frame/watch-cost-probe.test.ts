import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isolate } from '../../src/frame';

it('measures ten thousand calls with the complete built-in watch', () => {
  const frame = isolate<{ honest(xs: number[]): number }>({
    module: fileURLToPath(new URL('./fixtures/builtins/calls.ts', import.meta.url)),
    seed: 71,
    plain: false,
  });
  const began = performance.now();
  try {
    for (let i = 0; i < 10_000; i += 1) expect(frame.product.honest([1, 2, 3])).toBe(6);
    console.log('WATCH_COST_MS', performance.now() - began);
    expect(frame.alteredSince(0)).toBeUndefined();
  } finally {
    frame.close();
  }
}, 60_000);
