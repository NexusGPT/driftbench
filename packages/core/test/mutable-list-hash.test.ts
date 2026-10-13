import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256WithList } from '../src/spec/hash';

describe('new hash heads on a mutable list', () => {
  it('hashes the current list after the same array grows or replaces an item', () => {
    const items = [{ value: 'first' }];
    const plain = (head: string) =>
      createHash('sha256')
        .update(`${head}${canonicalJson(items)}tail`)
        .digest('hex');
    expect(sha256WithList('mutable-head-0', items, 'tail')).toBe(plain('mutable-head-0'));
    items.push({ value: 'second' });
    expect(sha256WithList('mutable-head-1', items, 'tail')).toBe(plain('mutable-head-1'));
    items[0] = { value: 'replacement' };
    expect(sha256WithList('mutable-head-2', items, 'tail')).toBe(plain('mutable-head-2'));
  });
});
