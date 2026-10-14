import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { replayPointwiseFacts, reportUrl } from '../../../comparisons/langfuse/pointwise-fact-ledger/replay';

describe('frozen pointwise fact candidate through the public API', () => {
  it('replays every prompt byte, verdict and strict transition without live calls', async () => {
    const report = await replayPointwiseFacts();
    expect(report).toEqual(JSON.parse(await readFile(reportUrl, 'utf8')));
    expect(report.liveCalls).toBe(0);
    expect(report.slices.map((slice) => [slice.n, slice.semantic.correct])).toEqual([
      [192, 192],
      [180, 178],
    ]);
    expect(report.slices.every((slice) => slice.semantic.inconclusive === 0)).toBe(true);
  });
});
