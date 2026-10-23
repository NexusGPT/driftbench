import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';

const PRODUCT = fileURLToPath(new URL('./fixtures/cheats.ts', import.meta.url));
type Product = { honest: (xs: number[]) => number };

it.each([0, 1])('keeps overlapping frames independent when frame %i closes', (closed) => {
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
}, 60_000);

it('never publishes a partial request when a write is interrupted', () => {
  const frame = isolate<Product>({ module: PRODUCT, seed: 2, tag: 'interrupted-write' });
  const write = fs.writeFileSync;
  const interrupted = new Error('interrupted request write');
  let request = '';
  const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
    if (typeof file === 'string' && data === '[101,202,303]') {
      request = file;
      write(file, '[101,');
      throw interrupted;
    }
    return write(file, data, options);
  });
  syncBuiltinESMExports();
  try {
    // A request is an encoded argument list, so target that write without knowing its filename.
    expect(() =>
      (frame.product.honest as unknown as (...xs: number[]) => number)(101, 202, 303),
    ).toThrow(interrupted);
    expect(request).not.toBe('');
    expect(fs.existsSync(request)).toBe(false);
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    frame.close();
  }
}, 60_000);
