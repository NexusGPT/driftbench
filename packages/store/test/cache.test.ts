import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMemoryStore, type SqliteStore } from '../src/index';
import { observed, storeError } from './fixtures';

const T0 = new Date('2026-10-11T10:00:00.000Z');
const KEY = 'abc123abc123:0:given-0:function/acme-sales:1.0.0';

let store: SqliteStore;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  store = openMemoryStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await store.close();
});

function at(ms: number): void {
  vi.setSystemTime(new Date(T0.getTime() + ms));
}

describe('the response cache', () => {
  it('round trips an Observed', async () => {
    await store.cachePut(KEY, observed());
    expect(await store.cacheGet(KEY)).toStrictEqual(observed());
    expect(await store.cacheGet('another key')).toBeUndefined();
  });

  it('serves an entry until its ttl has passed, then returns undefined', async () => {
    await store.cachePut(KEY, observed(), 60_000);
    at(59_999);
    expect(await store.cacheGet(KEY)).toStrictEqual(observed());
    at(60_000);
    expect(await store.cacheGet(KEY)).toBeUndefined();
    at(0);
    expect(await store.cacheGet(KEY)).toBeUndefined();
  });

  it('keeps an entry put without a ttl forever', async () => {
    await store.cachePut(KEY, observed());
    at(10 * 365 * 24 * 3_600_000);
    expect(await store.cacheGet(KEY)).toStrictEqual(observed());
  });

  it('expires a ttl of 0 at once', async () => {
    await store.cachePut(KEY, observed(), 0);
    expect(await store.cacheGet(KEY)).toBeUndefined();
  });

  it('replaces an entry put again, ttl included', async () => {
    await store.cachePut(KEY, observed('first reply'), 1_000);
    await store.cachePut(KEY, observed('second reply'));
    at(5_000);
    expect((await store.cacheGet(KEY))?.text).toBe('second reply');
  });

  it('refuses a ttl that is negative, not finite or past the date range, and an invalid Observed', async () => {
    for (const ttl of [-1, Number.NaN, Number.POSITIVE_INFINITY, 9e15]) {
      const error = await storeError(() => store.cachePut(KEY, observed(), ttl));
      expect(error.code, String(ttl)).toBe('INVALID_RECORD');
    }
    const broken = { ...observed(), latencyMs: -5 };
    expect((await storeError(() => store.cachePut(KEY, broken))).code).toBe('INVALID_RECORD');
    expect((await storeError(() => store.cachePut('', observed()))).code).toBe('INVALID_RECORD');
    expect(await store.cacheGet(KEY)).toBeUndefined();
  });
});
