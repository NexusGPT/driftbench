import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalList } from '../src/spec/hash';

describe('canonical text of an extending immutable prefix', () => {
  it('does not look up every earlier object in the text cache again', () => {
    const prefix = Array.from({ length: 400 }, (_, index) => ({
      role: 'assistant',
      content: `message ${index}`,
      tool_calls: [{ input: { z: index, a: [1, null] } }],
    }));
    canonicalList(prefix);
    const extended = [...prefix, { role: 'user', content: 'next', tool_calls: [] }];
    const expected = canonicalJson(extended);
    const originalGet = WeakMap.prototype.get;
    let lookups = 0;
    let actual: string;
    WeakMap.prototype.get = function (key) {
      lookups += 1;
      return originalGet.call(this, key);
    };
    try {
      actual = canonicalList(extended);
    } finally {
      WeakMap.prototype.get = originalGet;
    }
    expect(actual).toBe(expected);
    expect(lookups).toBeLessThanOrEqual(4);
  });
});
