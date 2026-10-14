import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { openMemoryStore } from '../src/index';

const store = openMemoryStore();
afterEach(() => vi.restoreAllMocks());
afterAll(() => store.close());

async function version() {
  return (
    await store.pushVersion('dataset', 'refs', [{ path: 'one.txt', bytes: new TextEncoder().encode('one') }])
  ).version;
}

describe('numeric registry hash prefixes', () => {
  it.each(['dataset', 'prompt'] as const)('resolves a full digit-only %s hash', async (kind) => {
    const one = { ...(await version()), kind, hash: '456042'.padEnd(64, '1') };
    vi.spyOn(store, 'listVersions').mockResolvedValue([one]);
    expect(await store.getVersion(kind, 'refs', one.hash)).toEqual(one);
    expect(await store.getVersion(kind, 'refs', '1')).toEqual(one);
    expect(await store.getVersion(kind, 'refs', '12345')).toBeUndefined();
    expect(await store.getVersion(kind, 'refs', '1'.repeat(65))).toBeUndefined();
  });

  it('resolves a numeric hash prefix when that version number does not exist', async () => {
    const one = { ...(await version()), hash: '456042'.padEnd(64, 'a') };
    vi.spyOn(store, 'listVersions').mockResolvedValue([one]);
    expect(await store.getVersion('dataset', 'refs', '456042')).toEqual(one);
    expect(await store.getVersion('dataset', 'refs', one.hash)).toEqual(one);
    expect(await store.getVersion('dataset', 'refs', '12345')).toBeUndefined();
  });

  it('keeps an existing version number ahead of a matching numeric hash prefix', async () => {
    const one = { ...(await version()), hash: '456042'.padEnd(64, 'a') };
    const numbered = { ...one, version: 456042, hash: 'abcdef'.padEnd(64, 'b') };
    vi.spyOn(store, 'listVersions').mockResolvedValue([one, numbered]);
    expect(await store.getVersion('dataset', 'refs', '456042')).toEqual(numbered);
  });

  it('rejects an ambiguous numeric hash prefix with the ordinary hash-prefix error', async () => {
    const one = { ...(await version()), hash: '456042'.padEnd(64, 'a') };
    const two = { ...one, version: 2, hash: '456042'.padEnd(64, 'b') };
    vi.spyOn(store, 'listVersions').mockResolvedValue([one, two]);
    await expect(store.getVersion('dataset', 'refs', '456042')).rejects.toMatchObject({
      code: 'INVALID_RECORD',
      message: 'store: dataset refs@456042 matches versions 1, 2; give more of the hash',
    });
  });
});
