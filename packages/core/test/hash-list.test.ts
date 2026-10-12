import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blockCacheKey } from '../src/runner/cache';
import { resolveGiven } from '../src/runner/given';
import {
  canonicalJson,
  canonicalJsonWithList,
  cloneJson,
  contentHash,
  contentHashWithList,
} from '../src/spec/hash';

const messages = [
  { role: 'user', content: 'hello' },
  {
    role: 'assistant',
    content: 'hi',
    tool_calls: [{ label: 'a.b', input: { z: 1, a: [1, { y: 2, x: undefined }] } }],
  },
];

describe('the canonical text of a list read item by item', () => {
  it('is the text canonicalJson gives, and the hash is the content hash', () => {
    const value = { vars: { b: 1, a: 2 }, prefix: [...messages, null, 3], ledger: {}, skipped: undefined };
    expect(canonicalJsonWithList(value, 'prefix')).toBe(canonicalJson(value));
    expect(contentHashWithList(value, 'prefix')).toBe(contentHash(value));
    expect(canonicalJsonWithList({ prefix: [] }, 'prefix')).toBe(canonicalJson({ prefix: [] }));
  });

  it('gives a block cache key equal to the canonical JSON of the whole parts', () => {
    const given = resolveGiven({ ledger: { k: 'v' }, world: {}, vars: {} }, messages, {
      adapter: 'function',
    });
    const parts = {
      specHash: 'abc',
      repeat: 0,
      position: 2,
      given,
      stimulus: { user: 'again' },
      target: { adapter: 'function' },
      adapter: 'function',
      adapterVersion: '1',
    };
    const { hash, ...body } = given;
    expect(hash).toBe(contentHash(body));
    expect(blockCacheKey(parts)).toBe(
      `block:${createHash('sha256').update(canonicalJson(parts)).digest('hex')}`,
    );
  });
});

describe('cloneJson', () => {
  it('copies deep, keeps what structuredClone keeps, and shares nothing', () => {
    const date = new Date(0);
    const source = { a: [1, { b: 'c' }], d: date, e: null, f: undefined };
    const copy = cloneJson(source);
    expect(copy).toEqual(structuredClone(source));
    expect(copy.a).not.toBe(source.a);
    expect(copy.a[1]).not.toBe(source.a[1]);
    expect(copy.d).not.toBe(date);
  });
});
