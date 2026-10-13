import { describe, expect, it } from 'vitest';
import { type BlockKeyParts, blockCacheKey } from '../../src/runner/cache';

const parts: BlockKeyParts = {
  specHash: 'hash-1',
  repeat: 0,
  position: 0,
  given: { ledger: {}, prefix: [], world: {} } as never,
  stimulus: { user: 'hi' },
  target: { adapter: 'function', agent: 'demo' },
  adapter: 'function',
  adapterVersion: 'v1',
};

describe('the cache key per suite', () => {
  it('is unchanged when no suite is named, so existing caches keep their keys', () => {
    expect(blockCacheKey(parts)).toBe(blockCacheKey({ ...parts, suite: undefined }));
  });

  it('differs between two suites, so a new suite name invalidates the cached blocks of the old one', () => {
    expect(blockCacheKey({ ...parts, suite: 'nightly-2' })).not.toBe(
      blockCacheKey({ ...parts, suite: 'nightly-1' }),
    );
    expect(blockCacheKey({ ...parts, suite: 'nightly-1' })).not.toBe(blockCacheKey(parts));
  });
});

describe('each block records the cache key it was stored under', () => {
  // The run that stores a block under this key and reads it back is in run.test.ts. A resolved Given
  // always carries its prefix, the list the key reads message by message.
  it('the block key is the block prefix and a SHA-256 digest, the form a block result carries', () => {
    expect(
      blockCacheKey({ ...parts, given: { ...parts.given, prefix: [{ role: 'user', content: 'x' }] } }),
    ).toMatch(/^block:[0-9a-f]{64}$/);
    expect(blockCacheKey(parts)).toMatch(/^block:[0-9a-f]{64}$/);
  });
});
