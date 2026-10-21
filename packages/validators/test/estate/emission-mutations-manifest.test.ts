import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildManifest, MANIFEST_PATH, PINNED_SEEDS, partPath, type Row } from './emission-support';

// The manifest of all four pinned seeds, composed from the parts the four seed tests wrote in the same CI run.
// Pooled over the rows of all four seeds, it asserts what the single enumeration test asserted at its end. It runs
// in the `emission-manifest` job of ci.yml (EMISSION_AGGREGATE=1), after the parts of the shards are downloaded; a
// missing part fails it. In an ordinary run the parts are not there and the test is skipped.
describe('estate completion emitted assertion structure', () => {
  it.skipIf(process.env.EMISSION_AGGREGATE !== '1')(
    'composes the emission mutation manifest from the four seeds',
    () => {
      const rows: Row[] = [];
      const gaps: string[] = [];
      for (const seed of PINNED_SEEDS) {
        const part = JSON.parse(readFileSync(partPath(seed), 'utf8')) as {
          seed: number;
          rows: Row[];
          gaps: string[];
        };
        expect(part.seed).toBe(seed);
        expect(part.rows.length, `seed ${seed} rows`).toBeGreaterThan(0);
        rows.push(...part.rows);
        gaps.push(...part.gaps);
      }
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(buildManifest(rows, gaps), null, 2)}\n`);
      expect(gaps).toEqual([]);
      expect(rows.filter((row) => row.verdict === 'survived')).toEqual([]);
      expect(rows.every((row) => row.control && row.restored)).toBe(true);
    },
  );
});
