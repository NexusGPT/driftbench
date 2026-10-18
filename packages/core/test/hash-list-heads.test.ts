import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/schema/common';
import { canonicalJson, sha256WithList } from '../src/spec/hash';

/**
 * A history hashed under a head that changes on every block (a ledger that grows, another block position)
 * keeps the bytes of the plain digest and reads each message once, not once per block.
 */

function plain(head: string, items: readonly unknown[], tail: string): string {
  return createHash('sha256')
    .update(`${head}${canonicalJson(items)}${tail}`)
    .digest('hex');
}

describe('a list hashed under a new head each time', () => {
  it('gives the plain digest and reads each item a bounded number of times', () => {
    const items: Message[] = [];
    const tracked = new Set<object>();
    let reads = 0;
    const get = WeakMap.prototype.get;
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
      if (tracked.has(key)) reads += 1;
      return get.call(this, key);
    };
    try {
      for (let index = 0; index < 200; index += 1) {
        const message: Message = { role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}` };
        items.push(message);
        tracked.add(message);
        const list = [...items];
        const head = `{"ledger":{"step":${index}},"prefix":`;
        expect(sha256WithList(head, list, '}')).toBe(plain(head, list, '}'));
        // A second list under another head, as the block cache key hashes the same prefix.
        const key = `{"given":{"position":${index}},"prefix":`;
        expect(sha256WithList(key, list, '}')).toBe(plain(key, list, '}'));
      }
    } finally {
      WeakMap.prototype.get = get;
    }
    expect(reads).toBeLessThanOrEqual(2 * 200);
  });
});
