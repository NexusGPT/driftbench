import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { impossiblePairs, jointlyPossible } from '../../src/ladders/generator/possible';

/**
 * A partial cell is allowed only when an allowed full cell holds it (the definition of an allowed t-tuple in
 * constrained combinatorial testing, NIST SP 800-142, stated in packages/generate/src/seed/feasible.ts). The joint
 * witness completes every axis the cell leaves open, the behaviour axis included.
 *
 * Hidden map of seed 14: the flow that says D10_return at the choice and recap stages is `new-request`, whose behaviours
 * B-003 and B-004 are web-only. No behaviour of that flow is allowed on the messaging channel, so no full cell holds
 * D10_return x messaging x choice or x recap.
 */
describe('the joint witness completes the behaviour axis', () => {
  const hidden = hiddenSpec(14);

  it('has the map the cases below read', () => {
    expect(hidden.channels).toEqual(['web', 'messaging']);
    expect(hidden.flows.find((flow) => flow.id === 'new-request')?.behaviours).toEqual(['B-003', 'B-004']);
    expect(hidden.behaviours.find((entry) => entry.id === 'B-003')?.channels).toEqual(['web']);
    expect(hidden.behaviours.find((entry) => entry.id === 'B-004')?.channels).toEqual(['web']);
  });

  it.each(['choice', 'recap', 'done'])('refuses D10_return x messaging x %s', (stage) => {
    expect(jointlyPossible(hidden, { deviation: 'D10_return', channel: 'messaging', stage })).toBe(false);
  });

  it('keeps the same cells on the web channel, where B-003 and B-004 are allowed', () => {
    expect(jointlyPossible(hidden, { deviation: 'D10_return', channel: 'web', stage: 'choice' })).toBe(true);
    expect(jointlyPossible(hidden, { deviation: 'D10_return', channel: 'web', stage: 'recap' })).toBe(true);
  });

  it('keeps a messaging cell that a behaviour of the flow can carry', () => {
    // The status-check and change-request flows list B-001 and B-002, which allow every channel.
    expect(jointlyPossible(hidden, { deviation: 'none', channel: 'messaging', stage: 'check' })).toBe(true);
    expect(jointlyPossible(hidden, { channel: 'messaging', stage: 'intake' })).toBe(true);
  });

  it('refuses a cell whose stage only web-only flows reach on the messaging channel', () => {
    expect(jointlyPossible(hidden, { channel: 'messaging', stage: 'done' })).toBe(false);
    expect(jointlyPossible(hidden, { channel: 'web', stage: 'done' })).toBe(true);
  });

  it('lists the refused pairs among the impossible pairs of the map', () => {
    const texts = impossiblePairs(hidden).map(({ forbid }) => JSON.stringify(Object.entries(forbid).sort()));
    expect(texts).toContain(JSON.stringify([['channel', 'messaging'], ['stage', 'done']]));
  });

  it('refuses the same shape on other hidden maps (seeds 5 and 8)', () => {
    const five = hiddenSpec(5);
    expect(jointlyPossible(five, { deviation: 'D10_return', channel: 'messaging', stage: 'intake' })).toBe(false);
    const eight = hiddenSpec(8);
    expect(jointlyPossible(eight, { deviation: 'D9_out_of_scope', channel: 'messaging', stage: 'opening' })).toBe(
      false,
    );
  });
});
