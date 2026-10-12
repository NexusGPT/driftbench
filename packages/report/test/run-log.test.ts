import { describe, expect, it } from 'vitest';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

describe('the per-run log of the scorecard keeps what the run record stores', () => {
  const stored = {
    ...run({ repeat: 0, blocks: [{ usd: 0.02, latencyMs: 180 }, {}] }),
    cost: 0.05,
    latencyMs: 900,
    cacheHit: true,
    startedAt: '2026-10-12T09:00:00.000Z',
    finishedAt: '2026-10-12T09:00:01.000Z',
  };

  it('shows the run timing, cost and cache state', () => {
    const detail = runDetailOf(dataOf([stored]), stored);
    expect(detail.startedAt).toBe('2026-10-12T09:00:00.000Z');
    expect(detail.finishedAt).toBe('2026-10-12T09:00:01.000Z');
    expect(detail.cost).toBe(0.05);
    expect(detail.latencyMs).toBe(900);
    expect(detail.cacheHit).toBe(true);
  });

  it('shows each block its latency, its cost and how many retries it took', () => {
    const detail = runDetailOf(dataOf([stored]), stored);
    expect(detail.blocks[0]?.latencyMs).toBe(180);
    expect(detail.blocks[0]?.costUsd).toBe(0.02);
    expect(detail.blocks[0]?.retries).toBe(0);
  });
});
