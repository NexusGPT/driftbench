import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';

const PRODUCT = fileURLToPath(new URL('./fixtures/cheats.ts', import.meta.url));
type Product = { honest: (xs: number[]) => number };

it.each([0, 1])(
  'keeps overlapping frames independent when frame %i closes',
  (closed) => {
    const frames: Frame<Product>[] = [];
    try {
      // The same module, seed and item tag occur in parallel validator tests/processes. Keep both
      // frames alive, then close one at the exact point where the other still needs its run C files.
      for (let i = 0; i < 2; i++) {
        const frame = isolate<Product>({ module: PRODUCT, seed: 1, tag: 'same-item' });
        frames.push(frame);
        expect(frame.product.honest([1, 2, 3])).toBe(4);
        expect(frame.divergence()).toBeUndefined();
      }
      frames[closed]?.close();
      const survivor = frames[1 - closed] as Frame<Product>;
      expect(survivor.product.honest([5, 6, 7])).toBe(12);
      expect(survivor.divergence()).toBeUndefined();
      // Serialized answers stay byte-identical across the twins, including the plain run.
      const last = survivor.tape.at(-1);
      expect(JSON.stringify(last?.plain)).toBe(JSON.stringify({ ret: 12 }));
      expect(last).toMatchObject({ ret: 12, twin: { ret: 12 }, wrapped: { ret: 12 } });
    } finally {
      for (const frame of frames) frame.close();
    }
  },
  60_000,
);

// Run C makes the calls of a frame in one process when the frame closes (PR 1403), from the file of calls the frame
// appends to: a write cut short must leave no part of its call there, and run C still answers every other call.
it('never publishes a partial request when a write is interrupted', () => {
  const frame = isolate<Product>({ module: PRODUCT, seed: 2, tag: 'interrupted-write' });
  const append = fs.appendFileSync;
  const interrupted = new Error('interrupted request write');
  let request = '';
  const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation((file, data, options) => {
    if (typeof file === 'string' && typeof data === 'string' && data.includes('[101,202,303]')) {
      request = file;
      append(file, data.slice(0, 20));
      throw interrupted;
    }
    return append(file, data, options);
  });
  syncBuiltinESMExports();
  try {
    expect(frame.product.honest([1, 2, 3])).toBe(4);
    // A request is an encoded argument list, so target that write without knowing its filename.
    expect(() => frame.product.honest([101, 202, 303])).toThrow(interrupted);
    expect(request).not.toBe('');
    const lines = fs.readFileSync(request, 'utf8');
    expect(lines.endsWith('\n')).toBe(true);
    expect(lines).not.toContain('[101,202,303]');
    spy.mockRestore();
    syncBuiltinESMExports();
    expect(frame.product.honest([5, 6, 7])).toBe(12);
    expect(frame.divergence()).toBeUndefined();
    expect(frame.tainted()).toBeUndefined();
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    frame.close();
  }
}, 60_000);
