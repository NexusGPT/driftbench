import { describe, expect, it } from 'vitest';
import { Campaign } from '../src/index';

const campaign = {
  campaignId: 'c1',
  specs: [{ id: 'acme-upgrade', hash: 'abc123abc123' }],
  targets: [{ adapter: 'function', agent: 'acme-sales' }],
  modes: ['F'],
  repeats: { T: 0, F: 1, P: 0 },
  budgetUsd: 0,
  judge: { mode: 'system1', judges: [] },
  createdAt: '2026-10-12T10:00:00Z',
};

const hash = 'a'.repeat(64);

describe('a campaign records the registry versions it ran', () => {
  it('accepts the dataset and prompt versions, and a campaign without any', () => {
    const sources = [
      { kind: 'dataset', name: 'acme-specs', version: 2, hash },
      { kind: 'prompt', name: 'acme-sales', version: 1, hash },
    ];
    expect(Campaign.parse({ ...campaign, sources }).sources).toEqual(sources);
    expect(Campaign.parse(campaign).sources).toBeUndefined();
  });

  it('refuses an unknown kind and a version that is not a whole number from 1', () => {
    const bad = (source: object) => Campaign.safeParse({ ...campaign, sources: [source] }).success;
    expect(bad({ kind: 'model', name: 'x', version: 1, hash })).toBe(false);
    expect(bad({ kind: 'dataset', name: 'x', version: 0, hash })).toBe(false);
    expect(bad({ kind: 'dataset', name: 'x', version: 1, hash, extra: true })).toBe(false);
  });
});
