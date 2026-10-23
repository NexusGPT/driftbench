import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, FrameError, isolate } from '../../src/frame';
import type * as identity from './fixtures/identity';

/**
 * Object identity across the boundary (docs/validators.md section 12.9; review of PR 1403, codex runs 39875360028 and
 * 39875900785): the caller sees the sharing a call in its own process would show.
 */

vi.setConfig({ testTimeout: 300_000 });

const PRODUCT = fileURLToPath(new URL('./fixtures/identity.ts', import.meta.url));
type Product = typeof identity;

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});
function frameOf(): Frame<Product> {
  const frame = isolate<Product>({ module: PRODUCT, seed: 7, plain: false });
  open.push(frame as Frame<unknown>);
  return frame;
}

describe('object identity under the frame', () => {
  it("gives the caller its own objects back when a result holds an argument's objects", () => {
    const frame = frameOf();
    const seeds = [{ a: 'x' }, { a: 'y' }];
    const plan = frame.product.rowsOf(seeds);
    expect(plan.rows[0]?.values).toBe(seeds[0]);
    expect(plan.rows[1]?.values).toBe(seeds[1]);
  });

  it('gives the caller one object for two results that are one object', () => {
    const frame = frameOf();
    const a = frame.product.cachedTotal([1, 2]);
    const b = frame.product.cachedTotal([1, 2]);
    expect(b).toBe(a);
    expect(frame.product.cachedTotal([3])).not.toBe(a);
  });

  it('gives the product its same object when the caller sends one again, changed in place', () => {
    const frame = frameOf();
    const input = { items: [1, 2] };
    expect(frame.product.countOf(input)).toBe(2);
    input.items.push(3);
    // A cache keyed by the object sees it again, as in the caller's own process: the stale count.
    expect(frame.product.countOf(input)).toBe(2);
    expect(frame.product.countOf({ items: [1, 2, 3] })).toBe(3);
  });

  it("gives the caller its own objects back inside a Map's values and keys and a Set's members", () => {
    const frame = frameOf();
    const item = { n: 1 };
    const got = frame.product.holders(item);
    expect(got.byValue.get('item')).toBe(item);
    expect([...got.byKey.keys()][0]).toBe(item);
    expect([...got.members][0]).toBe(item);
  });

  it('gives the product its same object when the caller sends one again inside a Map', () => {
    const frame = frameOf();
    const inner = { items: [1, 2] };
    expect(frame.product.countInMap(new Map([['x', inner]]))).toBe(2);
    inner.items.push(3);
    expect(frame.product.countInMap(new Map([['x', inner]]))).toBe(2);
  });

  it('gives the product its same frozen object when the caller sends it again', () => {
    const frame = frameOf();
    const input = Object.freeze({ id: 'a' });
    const first = frame.product.frozenCount(input);
    expect([first, frame.product.frozenCount(input)]).toEqual([first, first]);
    expect(frame.product.frozenCount(Object.freeze({ id: 'a' }))).not.toBe(first);
  });

  it('compares each later call on its own after a call that one run answered otherwise', () => {
    const frame = frameOf();
    frame.product.byEnvironment();
    expect(frame.divergence()).toBeDefined();
    const mark = frame.position();
    for (let n = 0; n < 3; n += 1) frame.product.rowsOf([{ a: 'x' }]);
    expect(frame.divergenceSince(mark)).toBeUndefined();
  });

  it('fails by name a call that makes as many new objects as one call has ids', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 7, plain: false, idSpan: 4 });
    open.push(frame as Frame<unknown>);
    expect(frame.product.manyObjects(2)).toHaveLength(2);
    expect(() => frame.product.manyObjects(5)).toThrow(FrameError);
    expect(() => frame.product.manyObjects(5)).toThrow(/4 new objects or more in one call/);
  });

  // The known limit, pinned: a product that changes an object it returned, between calls, while the caller keeps it.
  // In the caller's own process both hold one object and the caller sees the change; through the frame the caller's
  // object is the caller's copy, kept as the caller holds it.
  it('keeps the caller its own copy of a returned object the product changes later (known limit)', () => {
    const frame = frameOf();
    const first = frame.product.counter();
    const second = frame.product.counter();
    expect(second).toBe(first);
    expect(first.calls).toBe(1);
  });
});
