import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enumerateSeed, PINNED_SEEDS, partPath } from './emission-support';

// The enumeration of one pinned seed (the enumeration test held all four): the rows and the gaps of seed 3 of 4.
describe('estate completion emitted assertion structure', { timeout: 1_200_000 }, () => {
  it('enumerates every emitted check, entry and field with control, deletion and restoration: seed 3 of 4', async () => {
    const seed = PINNED_SEEDS[2] as number;
    const { rows, gaps } = await enumerateSeed(seed);
    mkdirSync(dirname(partPath(seed)), { recursive: true });
    writeFileSync(partPath(seed), `${JSON.stringify({ seed, rows, gaps }, null, 2)}\n`);
    expect(gaps).toEqual([]);
    expect(rows.filter((row) => row.verdict === 'survived')).toEqual([]);
    expect(rows.every((row) => row.control && row.restored)).toBe(true);
  });
});
