import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildManifest, MANIFEST_PATH, PINNED_SEEDS, partPath, type Row } from './emission-support';

// The manifest of all four pinned seeds, composed from the part each seed's enumeration test wrote.
describe('estate completion emitted assertion structure', () => {
  it('composes the emission mutation manifest from the four seeds', () => {
    const rows: Row[] = [];
    const gaps: string[] = [];
    for (const seed of PINNED_SEEDS) {
      const part = JSON.parse(readFileSync(partPath(seed), 'utf8')) as {
        seed: number;
        rows: Row[];
        gaps: string[];
      };
      expect(part.seed).toBe(seed);
      rows.push(...part.rows);
      gaps.push(...part.gaps);
    }
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(buildManifest(rows, gaps), null, 2)}\n`);
    expect(gaps).toEqual([]);
    expect(rows.filter((row) => row.verdict === 'survived')).toEqual([]);
    expect(rows.every((row) => row.control && row.restored)).toBe(true);
  });
});
