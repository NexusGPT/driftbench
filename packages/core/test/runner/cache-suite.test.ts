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
  it('the block result carries a block key, the same one the cache holds it under', async () => {
    const { blockCacheKey } = await import('../../src/runner/cache');
    expect(
      typeof blockCacheKey({
        specHash: 'h',
        repeat: 0,
        position: 0,
        given: {} as never,
        stimulus: { user: 'x' },
        target: { adapter: 'a' },
        adapter: 'a',
        adapterVersion: 'v',
      }),
    ).toBe('string');
  });
});
