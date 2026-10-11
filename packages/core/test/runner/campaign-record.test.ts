import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/schema/run';

/** The campaign record: a spec entry may pin the one target it runs on. */
const base = {
  campaignId: 'c-acme',
  specs: [{ id: 'acme-plan-upgrade', hash: 'abc123abc123' }],
  targets: [{ adapter: 'function', agent: 'acme-sales' }],
  modes: ['F'],
  repeats: { T: 0, F: 2, P: 0 },
  budgetUsd: 0,
  judge: { mode: 'system1', judges: [] },
  createdAt: '2026-10-11T00:00:00.000Z',
};

describe('the Campaign record', () => {
  it('takes a spec entry with no target, as before', () => {
    expect(Campaign.safeParse(base).success).toBe(true);
  });

  it('takes a spec entry pinned to its own target, and keeps it', () => {
    const pinned = {
      ...base,
      specs: [
        {
          id: 'acme-plan-upgrade',
          hash: 'abc123abc123',
          target: { adapter: 'function', agent: 'acme-sales' },
        },
        { id: 'acme-price-sheet', hash: 'def456def456', target: { adapter: 'process', agent: 'acme-ops' } },
      ],
      targets: [
        { adapter: 'function', agent: 'acme-sales' },
        { adapter: 'process', agent: 'acme-ops' },
      ],
    };
    const parsed = Campaign.safeParse(pinned);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.specs[1]?.target).toEqual({ adapter: 'process', agent: 'acme-ops' });
  });

  it('refuses a pinned target that is not a target, and any other key on a spec entry', () => {
    const bad = {
      ...base,
      specs: [{ id: 'acme-plan-upgrade', hash: 'abc123abc123', target: { agent: 'x' } }],
    };
    expect(Campaign.safeParse(bad).success).toBe(false);
    const extra = { ...base, specs: [{ id: 'acme-plan-upgrade', hash: 'abc123abc123', note: 'x' }] };
    expect(Campaign.safeParse(extra).success).toBe(false);
  });
});
