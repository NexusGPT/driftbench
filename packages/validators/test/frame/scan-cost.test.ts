import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import type * as product from './fixtures/scan-cost';

const MODULE = fileURLToPath(new URL('./fixtures/scan-cost.ts', import.meta.url));
const open: Frame<typeof product>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

function frameOf() {
  const frame = isolate<typeof product>({ module: MODULE, seed: 71, aliasing: true, plain: true });
  open.push(frame);
  return frame;
}

describe('bounded snapshots of nested arrays and text', () => {
  it('keeps unchanged nested numeric runs, short special numbers and long text equal', () => {
    const frame = frameOf();
    const first = frame.product.fresh();
    expect(frame.product.fresh()).toEqual(first);
    frame.strictArguments(true);
    expect(frame.product.read(first)).toEqual(first);
    expect(frame.aliasSince(0)).toBeUndefined();
    expect(frame.divergence()).toBeUndefined();
    expect(frame.tainted()).toBeUndefined();
  }, 60_000);

  it.each(['row', 'zero', 'text', 'hidden'])('still reports a change to %s', (where) => {
    const frame = frameOf();
    frame.product.keep();
    frame.product.change(where);
    expect(frame.aliasSince(0)).toContain('has changed since');
    expect(frame.divergence()).toBeUndefined();
    expect(frame.tainted()).toBeUndefined();
  }, 60_000);
});
