import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Scan = { data: string; other: string; known: Map<object, number> };
type Helpers = { scan(value: unknown, prior?: Map<object, number>): Scan };
let base: Helpers;
let sized: Helpers;
const folder = mkdtempSync(join(tmpdir(), 'frame-scan-'));
beforeAll(async () => {
  const source = readFileSync(new URL('../../src/frame/driver.ts', import.meta.url), 'utf8');
  const template = (name: string) => {
    const start =
      source.indexOf(`const ${name} = String.raw\u0060`) + `const ${name} = String.raw\u0060`.length;
    return source.slice(start, source.indexOf('\n\u0060;', start));
  };
  const twin = template('TWIN');
  const current = [
    twin.slice(0, twin.indexOf('const «pending»')),
    template('CODEC'),
    twin.slice(twin.indexOf('// Aliased results'), twin.indexOf('if («setup».command)')),
    'export { «scan» as scan };',
  ].join('\n');
  const old = current
    .replace('new «floatArray»(«length» < 4096 ? «length» : 4096)', 'new «floatArray»(4096)')
    .replace('    let «indices» = 0;\n', '')
    .replace('            if («cell» !== undefined) «indices» += 1;\n', '')
    .replace(/let «i» = «kind» === 1[^;]+;/, 'let «i» = 0;');
  expect(old).not.toBe(current);
  for (const [name, program] of [
    ['base', old],
    ['sized', current],
  ] as const) {
    const path = join(folder, `${name}.mjs`);
    writeFileSync(path, program.replace(/«([a-zA-Z]+)»/g, '_test_$1'));
    const helpers: Helpers = await import(pathToFileURL(path).href);
    if (name === 'base') base = helpers;
    else sized = helpers;
  }
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));
function same(value: unknown, mutate?: () => void) {
  const before = base.scan(value);
  const actual = sized.scan(value);
  expect(actual).toEqual(before);
  if (mutate) {
    mutate();
    const after = sized.scan(value, actual.known);
    expect(after).toEqual(base.scan(value, before.known));
    expect(after.data + after.other).not.toBe(before.data + before.other);
  }
}
describe('exact array scan allocation and key traversal', () => {
  it.each([0, 1, 2, 4095, 4096, 4097, 8193])('preserves scan hashes at length %i', (length) => {
    const xs = Array.from({ length }, (_, i) => [i / 3, -0, NaN, Infinity, -Infinity][i % 5]);
    same([xs], () => {
      xs[length] = 7;
    });
  });
  it('does not skip extra keys when a tampered buffer getter removes indices mid-scan', () => {
    const proto = Object.getPrototypeOf(Float64Array.prototype);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'buffer');
    if (!descriptor?.get) throw new Error('missing typed-array buffer getter');
    const original = descriptor.get;
    const hashes = [];
    for (const helpers of [base, sized]) {
      const value = [1, 2];
      Object.defineProperty(proto, 'buffer', {
        configurable: true,
        get() {
          delete value[0];
          delete value[1];
          Object.defineProperty(value, 'extra', { value: 7 });
          Object.defineProperty(proto, 'buffer', descriptor);
          return Reflect.apply(original, this, []);
        },
      });
      try {
        const result = helpers.scan(value);
        hashes.push([result.data, result.other]);
      } finally {
        Object.defineProperty(proto, 'buffer', descriptor);
      }
    }
    expect(hashes[1]).toEqual(hashes[0]);
  });
  it('preserves the bytes of distinct NaN payloads', () => {
    const buffer = new ArrayBuffer(16);
    const bits = new BigUint64Array(buffer);
    const values = new Float64Array(buffer);
    bits[0] = 0x7ff8000000000001n;
    bits[1] = 0x7ff8000000000002n;
    same([values[0], values[1], -0]);
  });
  it('preserves mixed runs, nested short rows, and empty arrays', () => {
    same([[], [1, 'x', 2, null, 3, undefined, 4], Array.from({ length: 20000 }, (_, i) => [i, i / 2])]);
  });
  it('preserves holes, accessors, flags, extra keys, and changed prototypes', () => {
    const xs: unknown[] = [1, 2, 3];
    delete xs[1];
    Object.defineProperty(xs, '2', {
      get() {
        throw new Error('must not invoke');
      },
    });
    Object.defineProperty(xs, '0', { writable: false });
    Object.defineProperty(xs, 'hidden', { value: [5] });
    Object.defineProperty(xs, Symbol('extra'), { value: [6] });
    same(xs, () => {
      Object.setPrototypeOf(xs, null);
      Object.preventExtensions(xs);
    });
  });
  it('preserves containers, aliases, cycles, and object replacement identities', () => {
    const row = { n: 3 };
    const xs: unknown[] = [
      row,
      row,
      new Map([[row, [1]]]),
      new Set([row]),
      new Date(0),
      new Float64Array([NaN, -0]),
      new DataView(new ArrayBuffer(8)),
    ];
    xs.push(xs);
    same(xs, () => {
      xs[0] = { n: 3 };
    });
  });
  it('preserves the identity cap', () => {
    same(Array.from({ length: 100005 }, (_, i) => ({ i })));
  });
  it('checks extra keys after sparse indices inserted out of order', () => {
    const xs: unknown[] = [];
    xs[9] = 9;
    xs[2] = 2;
    for (const key of ['01', '-0', '1.0', '4294967295'])
      Object.defineProperty(xs, key, { value: [key], configurable: true });
    const sym = Symbol('after indices');
    Object.defineProperty(xs, sym, { value: 7, configurable: true });
    same(xs, () => {
      Object.defineProperty(xs, sym, { value: 8 });
    });
  });
  it('keeps a non-array object with array-like keys on the generic walk', () => {
    same({ '0': 0, '3': 3, length: 4, extra: 5 });
  });
  it('preserves frozen array descriptors', () => {
    same(Object.freeze([Object.freeze([1, -0, NaN]), Object.seal([4, 5])]));
  });
});
