import { describe, expect, it } from 'vitest';
import { prepareMap } from '../../src/seed/map';
import { ZED_TOOLS, zedProposal } from './support';

describe('prepareMap', () => {
  it('keeps approved values, constraints and phrases only', () => {
    const proposal = zedProposal();
    const user = proposal.dimensions.find((dimension) => dimension.id === 'user');
    if (!user?.values[1]) throw new Error('no user value');
    user.values[1].approved = false;
    const constraint = proposal.constraints[0];
    if (!constraint) throw new Error('no constraint');
    constraint.approved = false;
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS });
    const kept = prepared.map.dimensions.find((dimension) => dimension.id === 'user');
    expect(kept?.values.map((value) => value.id)).toEqual(['customer']);
    expect(prepared.map.constraints.map((entry) => entry.reason)).toEqual([
      'the card flow never reaches help',
    ]);
    // The phrase of the unapproved value goes with it; the unapproved phrase never counts.
    expect(prepared.phrases.map((phrase) => phrase.text)).not.toContain('This is the branch desk.');
    expect(prepared.phrases.map((phrase) => phrase.text)).not.toContain('Sent from my mail.');
    expect(prepared.phrases).toHaveLength(7);
  });

  it('hashes what the seeders read, so an approval changes the hash', () => {
    const before = prepareMap(zedProposal(), { tools: ZED_TOOLS }).hash;
    const proposal = zedProposal();
    const constraint = proposal.constraints[0];
    if (constraint) constraint.approved = false;
    expect(prepareMap(proposal, { tools: ZED_TOOLS }).hash).not.toBe(before);
    expect(prepareMap(zedProposal(), { tools: ZED_TOOLS }).hash).toBe(before);
  });
});
