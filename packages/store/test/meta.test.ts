import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/index';

describe('the store meta values', () => {
  it('keeps the first value of a key, across opens', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'meta-')), 'runs.db');
    const store = openStore(path);
    expect(await (store as unknown as { metaGet(k: string): Promise<string | undefined>; metaInit(k: string, v: string): Promise<string> }).metaGet('k')).toBeUndefined();
    expect(await (store as unknown as { metaGet(k: string): Promise<string | undefined>; metaInit(k: string, v: string): Promise<string> }).metaInit('k', 'one')).toBe('one');
    expect(await (store as unknown as { metaGet(k: string): Promise<string | undefined>; metaInit(k: string, v: string): Promise<string> }).metaInit('k', 'two')).toBe('one');
    await store.close();
    const again = openStore(path);
    expect(await (again as unknown as { metaGet(k: string): Promise<string | undefined> }).metaGet('k')).toBe('one');
    await again.close();
  });
});
