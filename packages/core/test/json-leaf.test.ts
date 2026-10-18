import { expect, it } from 'vitest';
import { z } from 'zod';
import { cloneJsonLeaf, isJsonLeaf, UNSUPPORTED_JSON } from '../src/spec/json-leaf';

it('recognizes only unrefined recursive JSON schema definitions', () => {
  expect(isJsonLeaf(z.json())).toBe(true);
  expect(isJsonLeaf(z.json().refine(() => false))).toBe(false);
  expect(isJsonLeaf(z.lazy(() => z.string()))).toBe(false);
  expect(isJsonLeaf(z.string())).toBe(false);
  const constrained: z.ZodType = z.lazy(() =>
    z.union([
      z.string().min(3),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(constrained),
      z.record(z.string(), constrained),
    ]),
  );
  expect(isJsonLeaf(constrained)).toBe(false);
});

it('matches JSON schema values and makes fresh containers at every depth', () => {
  const schema = z.json();
  const shared = { x: [1, true, null, -0, 'text'] };
  for (let index = 0; index < 1000; index += 1) {
    const input = { value: index, nested: [shared, { shared, empty: {}, array: [] }] };
    const copied = cloneJsonLeaf(input);
    expect(copied).toEqual(schema.parse(input));
    expect(copied).not.toBe(input);
    expect(JSON.stringify(copied)).toBe(JSON.stringify(schema.parse(input)));
  }
  const copied = cloneJsonLeaf(shared) as typeof shared;
  copied.x.push('changed');
  expect(shared.x).not.toContain('changed');
});

it('defers exotic values, accessors, cycles and invalid JSON to the original parser', () => {
  let reads = 0;
  const accessed = {
    get value() {
      reads += 1;
      return 'text';
    },
  };
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    Symbol('x'),
    () => 1,
    new Date(),
    new Map(),
    new Set(),
    new Array(2),
    accessed,
    cyclic,
    Object.defineProperty({}, '__proto__', { value: {}, enumerable: true }),
  ])
    expect(cloneJsonLeaf(value)).toBe(UNSUPPORTED_JSON);
  expect(reads).toBe(0);
  expect(z.json().parse(accessed)).toEqual({ value: 'text' });
  expect(reads).toBe(1);
});

it('defers record constructor rules and enumerable symbols to Zod', () => {
  const values = [
    Object.defineProperty({}, 'constructor', { value: function Custom() {} }),
    { [Symbol.toStringTag]: 'Date', value: 1 },
    { [Symbol('key')]: 'value' },
  ];
  for (const value of values) {
    expect(z.json().safeParse(value).success).toBe(false);
    expect(cloneJsonLeaf(value)).toBe(UNSUPPORTED_JSON);
  }
  const hidden = Object.defineProperty({ value: 1 }, Symbol('hidden'), { value: () => 1 });
  expect(cloneJsonLeaf(hidden)).toEqual(z.json().parse(hidden));
});
