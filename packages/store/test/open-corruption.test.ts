import { rm, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openStore, StoreError } from '../src/index';
import { campaign, tempDir } from './fixtures';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('opening a database cut inside its header', () => {
  it.each([40, 64, 67, 68, 77, 89])('reports OPEN_FAILED at %s bytes', async (bytes) => {
    const dir = await tempDir();
    made.push(dir);
    const path = join(dir, `cut-${bytes}.db`);
    const store = openStore(path);
    await store.putCampaign(campaign());
    await store.close();
    await truncate(path, bytes);
    let error: unknown;
    try {
      const opened = openStore(path);
      await opened.close();
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ code: 'OPEN_FAILED' });
    expect((error as Error).message).toContain(`cannot open the store at ${path}`);
  });
});
