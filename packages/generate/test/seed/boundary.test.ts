import { describe, expect, it } from 'vitest';
import { prepareMap } from '../../src/seed/map';
import { boundarySeeder } from '../../src/seed/seeders';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

describe('boundarySeeder', () => {
  it('sends an invalid tool input to incomplete/ when nothing but zero tool calls can fail it', () => {
    const prepared = prepareMap(zedProposal(), { tools: ZED_TOOLS });
    const { drafts } = boundarySeeder(prepared, { seed: 1, t: 2, max: Number.POSITIVE_INFINITY });
    const invalid = drafts.find((draft) => draft.title.includes('lookup.in.account.below-min-length'));
    const valid = drafts.find((draft) => draft.title.includes('lookup.in.account.at-min-length'));
    // A constant reply makes no call, so a block that only forbids calls is passed by it.
    expect(invalid?.reasons?.[0]).toMatch(/only forbids tool calls/);
    expect(valid?.reasons ?? []).toEqual([]);
  });
});
