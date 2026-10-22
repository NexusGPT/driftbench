import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import type * as calls from './fixtures/builtins/calls';
import type * as sweep from './fixtures/builtins/sweep';

/**
 * Built-in objects (docs/validators.md section 12.9). A product that changes a built-in object of its process (a
 * method replaced, a property added, a global name rebound, a prototype made not extensible) changes how its
 * caller's own code runs after the call, which a call in the caller's process shows and a confined run keeps to
 * itself (review of PR 986, codex run 39782335737). Each confined run records the built-in objects before the
 * product loads and reports a call after which one changed; the frame reports it as `alteredSince`, always.
 */

vi.setConfig({ testTimeout: 300_000 });

const CALLS = fileURLToPath(new URL('./fixtures/builtins/calls.ts', import.meta.url));
const AT_LOAD = fileURLToPath(new URL('./fixtures/builtins/at-load.ts', import.meta.url));
const EVAL_AT_LOAD = fileURLToPath(new URL('./fixtures/builtins/eval-at-load.ts', import.meta.url));
const INTL_AT_LOAD = fileURLToPath(new URL('./fixtures/builtins/intl-at-load.ts', import.meta.url));
const SWEEP = fileURLToPath(new URL('./fixtures/builtins/sweep.ts', import.meta.url));
type Calls = typeof calls;
type Sweep = typeof sweep;

const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

function frameOf<T>(module: string, aliasing = true): Frame<T> {
  const frame = isolate<T>({ module, seed: 13, aliasing, plain: false });
  open.push(frame as Frame<unknown>);
  return frame;
}

describe('built-in objects under the frame', () => {
  it('finds nothing in a product that changes nothing, over several calls', () => {
    const frame = frameOf<Calls>(CALLS);
    expect(frame.product.honest([1, 2, 3])).toBe(6);
    expect(frame.product.honest([4, 5])).toBe(9);
    expect(frame.alteredSince(0)).toBeUndefined();
  });

  it.each([
    ['replaceMap', 'Array.prototype.map'],
    ['replaceSqrt', 'Math.sqrt'],
    ['addToObject', 'a property added to or removed from Object.prototype'],
    ['rebindJson', 'the global name JSON'],
    ['sealNumber', 'the extensibility of Number.prototype'],
    ['replaceIterator', '%ArrayIteratorPrototype%.next'],
    ['replaceEval', 'the global name eval'],
    ['replaceFormatToParts', 'Intl.NumberFormat.prototype.formatToParts'],
  ] as const)('%s: the answer is right, and the call that changed %s is named', (name, where) => {
    const frame = frameOf<Calls>(CALLS);
    expect(frame.product.honest([1, 2])).toBe(3);
    const mark = frame.position();
    expect(frame.alteredSince(0)).toBeUndefined();
    expect(frame.product[name]([1, 2, 3])).toBe(6);
    const found = frame.alteredSince(mark);
    expect(found).toContain(
      `${name}() ran in a process where the product had changed a built-in object, ${where} (`,
    );
  });

  it('names the change on every later call too, as every later call of a caller runs with it', () => {
    const frame = frameOf<Calls>(CALLS);
    frame.product.replaceSqrt([1]);
    const later = frame.position();
    frame.product.honest([2]);
    expect(frame.alteredSince(later)).toContain(
      'honest() ran in a process where the product had changed a built-in object, Math.sqrt (',
    );
  });

  it('names a change made by a call that throws', () => {
    const frame = frameOf<Calls>(CALLS);
    expect(() => frame.product.replaceAndThrow([1, 2])).toThrow('no sum for 2 values');
    expect(frame.alteredSince(0)).toContain('Array.prototype.every');
  });

  it.each([
    [AT_LOAD, 'Math.max'],
    [EVAL_AT_LOAD, 'the global name eval'],
    [INTL_AT_LOAD, 'Intl.NumberFormat.prototype.formatToParts'],
  ])('names a change the product made when it loaded, at its first call (%s: %s)', (module, where) => {
    const frame = frameOf<{ honest(xs: number[]): number }>(module);
    expect(frame.product.honest([1, 2, 3])).toBe(6);
    expect(frame.alteredSince(0)).toContain(
      `honest() ran in a process where the product had changed a built-in object, ${where} (`,
    );
  });

  it('watches with the aliasing option off too', () => {
    const frame = frameOf<Calls>(CALLS, false);
    frame.product.replaceMap([1]);
    expect(frame.alteredSince(0)).toContain('Array.prototype.map');
    expect(frame.aliasSince(0)).toBeUndefined();
  });

  // The watched objects come from the realm, not from a list (review of PR 986, codex runs 39821091340 and
  // 39821718881: a list of 55 names missed eval and Intl). Each sweep replaces one property at a time with a value
  // that differs, then puts it back: the change is named exactly, and once put back nothing is reported.
  it.each([
    ['every configurable global name', 'globalPaths', 100],
    ['every member of each global function, namespace and function prototype', 'memberPaths', 500],
  ] as const)('%s, replaced in a call, is named; put back, nothing is', (_name, list, least) => {
    const frame = frameOf<Sweep>(SWEEP);
    const paths = frame.product[list]();
    expect(paths.length).toBeGreaterThanOrEqual(least);
    const wrong: string[] = [];
    for (const path of paths) {
      const mark = frame.position();
      frame.product.replaceAt(path);
      const named = frame.alteredSince(mark);
      const want = path.length === 1 ? `the global name ${path[0]}` : path.join('.');
      if (!named?.includes(`a built-in object, ${want} (`)) {
        wrong.push(`${path.join('.')} replaced: ${named}`);
      }
      const back = frame.position();
      frame.product.restoreAt(path);
      const after = frame.alteredSince(back);
      if (after !== undefined) wrong.push(`${path.join('.')} put back: ${after}`);
    }
    expect(wrong).toEqual([]);
  });
});
