import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
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
function twoCalls(name: keyof Product, aliasingOn: boolean, plain = false) {
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
});
