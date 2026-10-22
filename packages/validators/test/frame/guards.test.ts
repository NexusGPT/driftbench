import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import * as guards from './fixtures/guards';

/**
 * What the frame keeps of the caller's world around a call (docs/validators.md section 12.9, "Objects the caller
 * passes twice"). The confined runs get every argument as data, so three things an item in the validator's own process
 * could see are lost unless the frame carries them: that an object passed again is the same object, that an argument is
 * frozen, and that a result is built new. The frame carries them, and it holds a call under the clock and the random
 * sources the item names.
 */

vi.setConfig({ testTimeout: 300_000 });

const PRODUCT = fileURLToPath(new URL('./fixtures/guards.ts', import.meta.url));
type Product = typeof guards;

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});
const frameOf = (options: Partial<Parameters<typeof isolate>[0]> = {}): Frame<Product> => {
  const frame = isolate<Product>({ module: PRODUCT, seed: 21, plain: false, ...options });
  open.push(frame as Frame<unknown>);
  return frame;
};

describe('identity of the objects passed twice', () => {
  it('an object edited in place and passed again is the same object to the product, so a cache by object is stale', () => {
    const frame = frameOf({ identity: true });
    const xs = [1, 2, 3];
    expect(frame.product.cachesByObject(xs).total).toBe(6);
    xs.push(4);
    // The product returns what it kept for the object: 6, where a fresh copy gives 10.
    expect(frame.product.cachesByObject(xs).total).toBe(6);
    expect(frame.product.cachesByObject([...xs]).total).toBe(10);
  });

  it('without the option every call is a new object and the cache never hits', () => {
    const frame = frameOf();
    const xs = [1, 2, 3];
    frame.product.cachesByObject(xs);
    xs.push(4);
    expect(frame.product.cachesByObject(xs).total).toBe(10);
  });

  it('forget() ends the identity of the objects passed so far', () => {
    const frame = frameOf({ identity: true });
    const xs = [1, 2, 3];
    frame.product.cachesByObject(xs);
    xs.push(4);
    frame.forget();
    expect(frame.product.cachesByObject(xs).total).toBe(10);
  });
});

describe('frozen arguments', () => {
  it('a product that writes to a frozen argument is refused by the runtime, as in the validator process', () => {
    const frame = frameOf({ identity: true });
    expect(frame.product.writesWhenItCan(Object.freeze([1, 2])).wrote).toBe(false);
    expect(frame.product.writesWhenItCan([1, 2]).wrote).toBe(true);
  });
});

describe('the guards around a call', () => {
  it('mutation: a product that sorts its argument in place is found', () => {
    const frame = frameOf();
    const found = frame.guarded(['mutation'], () => {
      frame.product.sortsInPlace([3, 1, 2]);
      return frame.guardSince(0);
    });
    expect(found).toContain('argument 1');
  });

  it('mutation: a product that leaves its argument as it was is not found', () => {
    const frame = frameOf();
    const found = frame.guarded(['mutation'], () => {
      frame.product.total([3, 1, 2]);
      return frame.guardSince(0);
    });
    expect(found).toBeUndefined();
  });

  it('sharing: a result that is part of the arguments is found', () => {
    const frame = frameOf();
    const found = frame.guarded(['sharing'], () => {
      frame.product.returnsItsArgument({ items: [1] });
      return frame.guardSince(0);
    });
    expect(found).toContain('its arguments');
  });

  it('sharing: a result that holds an object of an earlier result is found', () => {
    const frame = frameOf();
    const found = frame.guarded(['sharing'], () => {
      frame.product.returnsTheSameObject([1]);
      frame.product.returnsTheSameObject([2]);
      return frame.guardSince(0);
    });
    expect(found).toContain('an earlier result');
  });

  it('sharing: a result built new on every call is not found', () => {
    const frame = frameOf();
    const found = frame.guarded(['sharing'], () => {
      frame.product.total([1]);
      frame.product.total([2]);
      return frame.guardSince(0);
    });
    expect(found).toBeUndefined();
  });

  it('sharing limited to named functions leaves the others alone', () => {
    const frame = frameOf();
    const found = frame.guarded(
      ['sharing'],
      () => {
        frame.product.returnsItsArgument({ items: [1] });
        return frame.guardSince(0);
      },
      ['total'],
    );
    expect(found).toBeUndefined();
  });

  it('nothing is guarded outside guarded()', () => {
    const frame = frameOf();
    frame.product.sortsInPlace([3, 1, 2]);
    expect(frame.guardSince(0)).toBeUndefined();
  });
});

describe('the ambient state of a call', () => {
  it('the clock stands where the item puts it, and only for the call', () => {
    const frame = frameOf();
    const held = frame.ambient([{ kind: 'clock', at: 1_000_000_000_000 }], () => frame.product.reads().now);
    expect(held).toBe(1_000_000_000_000);
    expect(frame.product.reads().now).not.toBe(1_000_000_000_000);
  });

  it('the random source throws for the call, and works again after it', () => {
    const frame = frameOf();
    expect(() => frame.ambient([{ kind: 'random' }], () => frame.product.throwsOnRandom())).toThrow(
      /Math\.random was called/,
    );
    expect(frame.product.throwsOnRandom().ok).toBe(true);
  });
});

describe('a product that is an object of functions', () => {
  it('is called by the name of its members when the option names the export', () => {
    const frame = isolate<{ twice(n: number): number }>({
      module: PRODUCT,
      seed: 21,
      plain: false,
      members: ['variablesImpl'],
    });
    open.push(frame as Frame<unknown>);
    expect(frame.product.twice(21)).toBe(42);
  });
});

describe('files of the validator that the product must not import', () => {
  it('a product that imports one does not bundle, and the error names the file', () => {
    expect(() =>
      isolate({
        module: PRODUCT,
        seed: 21,
        plain: false,
        refuse: [fileURLToPath(new URL('./fixtures', import.meta.url))],
      }),
    ).toThrow(/guards\.ts, a file of the validator/);
  });
});
