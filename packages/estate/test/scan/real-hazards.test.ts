import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { hazardMeasurement, observatoryEstate } from './real-hazard-corpus';

describe('hazards inside large normative estates', () => {
  it.each([
    [1, 0],
    [48, 0],
    [64, 160_000],
  ])(
    'distinguishes recovery from documentary uses across %i skills',
    async (skills, paddingCharacters) => {
      const input = observatoryEstate(skills, paddingCharacters);
      const root = await estate(input.files);
      try {
        const scan = await scanEstate({
          root,
          reader: new ClaudeCodeReader({ chunkCharacters: 3000 }),
          now: NOW,
        });
        const report = hazardMeasurement(scan.map, input.passages);
        expect([
          ...new Set(
            report.mistakes.map((m) =>
              JSON.stringify({ text: m.passage.text, actual: m.actual, expected: m.passage.expected }),
            ),
          ),
        ]).toEqual([]);
        expect(report.recall).toBe(1);
        expect(report.precision).toBe(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
