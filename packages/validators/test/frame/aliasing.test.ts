import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import { twinDriver } from '../../src/frame/driver';
import type * as aliasing from './fixtures/aliasing';

/**
 * Aliased results (docs/validators.md section 12.9). The frame hands the item each answer as data, so an item
 * that keeps the first result across the second call cannot see a package that fills one object again or
 * overwrites the earlier result. With `aliasing: true` each confined run keeps the live results of its last calls
 * and reports a call after which one of them changed; the frame reports it as `aliasSince`.
 */

vi.setConfig({ testTimeout: 300_000 });

const PRODUCT = fileURLToPath(new URL('./fixtures/aliasing.ts', import.meta.url));
type Product = typeof aliasing;

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

/** The item: two calls, the first result read after the second. Returns whether it passes, and what the frame found. */
function twoCalls(name: 'fresh' | 'shared' | 'overwrite', aliasingOn: boolean, plain = false) {
  const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: aliasingOn, plain });
  open.push(frame as Frame<unknown>);
  const mark = frame.position();
  const a = frame.product[name]([1, 2, 3]);
  const b = frame.product[name]([10, 20, 30]);
  return { pass: a.total === 6 && b.total === 60, found: frame.aliasSince(mark) };
}

describe('aliased results under the frame', () => {
  it('finds nothing in a package that returns a new object on every call', () => {
    expect(twoCalls('fresh', true)).toEqual({ pass: true, found: undefined });
  });

  it.each(['shared', 'overwrite'] as const)(
    '%s: the item passes on the data, the frame finds the alias',
    (name) => {
      const run = twoCalls(name, true);
      expect(run.pass).toBe(true);
      expect(run.found).toContain('has changed since');
    },
  );

  it.each(['shared', 'overwrite'] as const)('%s: nothing is reported when the option is off', (name) => {
    expect(twoCalls(name, false).found).toBeUndefined();
  });

  it('reports a change once, at the call after which it is seen', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.overwrite([1]);
    frame.product.overwrite([2]);
    const later = frame.position();
    frame.product.fresh([3]);
    frame.product.fresh([4]);
    expect(frame.aliasSince(0)).toContain('has changed since');
    expect(frame.aliasSince(later)).toBeUndefined();
  });

  it.each(['proxied', 'holding'] as const)(
    '%s: a result that is or holds a Proxy is an invalid result',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]([1, 2, 3]);
      expect(frame.aliasSince(0)).toContain('Proxy');
    },
  );

  it.each(['withGetter', 'withSetter'] as const)(
    '%s: a result that holds an accessor property is an invalid result',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]([1, 2, 3]);
      expect(frame.aliasSince(0)).toContain('accessor');
    },
  );

  it('reports nothing for a Proxy result when the option is off', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: false, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.proxied([1, 2, 3]);
    expect(frame.aliasSince(0)).toBeUndefined();
  });

  it('finds a typed array refilled on every call whose own length property says 0', () => {
    const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
    open.push(frame as Frame<unknown>);
    frame.product.sharedTyped();
    frame.product.sharedTyped();
    expect(frame.aliasSince(0)).toContain('has changed since');
  });

  it.each(['withArrayGetter', 'withArraySetter'] as const)(
    '%s: an array element that is an accessor makes the result invalid',
    (name) => {
      const frame = isolate<Product>({ module: PRODUCT, seed: 11, aliasing: true, plain: false });
      open.push(frame as Frame<unknown>);
      frame.product[name]();
      expect(frame.aliasSince(0)).toContain('accessor');
    },
  );
});

// A package that patches an intrinsic the digest could use, with a shared value that only that intrinsic reads: the
// driver captured them before the product loaded, so the change is still seen.
describe('aliased results when the package patches the iteration and time intrinsics', () => {
  const module = (name: string) =>
    fileURLToPath(new URL(`./fixtures/alias-patched/${name}.ts`, import.meta.url));
  it.each(['map', 'set', 'date'])('finds a shared %s refilled on every call', (name) => {
    const frame = isolate<{ next(): unknown }>({
      module: module(name),
      seed: 11,
      aliasing: true,
      plain: false,
    });
    open.push(frame as Frame<unknown>);
    frame.product.next();
    frame.product.next();
    expect(frame.aliasSince(0)).toContain('has changed since');
  });

  // The digest walk uses nothing the product can reach: no global is read by name and no method is called on a
  // value or a prototype. Every helper is a constant taken before the product loads and applied with Reflect.apply.
  it('walks with captured references only', () => {
    const source = twinDriver(1, 'source-check');
    const start = source.indexOf('// Aliased results');
    const end = source.indexOf('new Array(16)');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, end);
    expect(
      body.match(
        /\b(Reflect|JSON|Object|Array|ArrayBuffer|Map|Set|WeakSet|Date|Number|String|Symbol|Math)\./g,
      ),
    ).toBeNull();
    expect(
      body.match(
        /\.(update|digest|next|getTime|entries|values|has|add|push|shift|slice|concat|join|map|forEach)\(/g,
      ),
    ).toBeNull();
    // no iteration protocol (for-of, spread): the array and Map iterators are patchable
    expect(body).not.toMatch(/for \((const|let|var) [^;)]*\bof\b/);
    expect(body).not.toMatch(/\[\.\.\.|\(\.\.\./);
  });
});
