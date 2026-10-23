import { describe, expect, it } from 'vitest';
import { appendAll } from '../../src/pointer/scan';

describe('appending the items of a long list', () => {
  const items = Array.from({ length: 200_000 }, (_, at) => `refusal ${at}`);

  it('takes 200,000 items, where a spread into push overflows the call', () => {
    const target: string[] = ['first'];
    appendAll(target, items);
    expect(target).toHaveLength(200_001);
    expect(target.at(-1)).toBe('refusal 199999');
    // The spread the helper replaces: the items become call arguments, and this many overflow the stack.
    expect(() => ([] as string[]).push(...items)).toThrow(RangeError);
  });

  it('keeps the order and changes nothing for an empty list', () => {
    const target = ['a'];
    appendAll(target, ['b', 'c']);
    appendAll(target, []);
    expect(target).toEqual(['a', 'b', 'c']);
  });
});
