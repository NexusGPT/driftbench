import type { Spec } from '@driftbench/core';
import { describe, expect, it } from 'vitest';
import { allowedSet, measureCoverage } from '../../src/enumerate/measure';
import { zedPrepared } from './support';

describe('measureCoverage', () => {
  it('counts the allowed pairs a spec places on, never a forbidden one', () => {
    const prepared = zedPrepared();
    const allowed = allowedSet(prepared, 2);
    // One block, no stage, no deviation: it places on flow=card, deviation=none and channel=email. Of its
    // three pairs, flow=card with channel=email is forbidden: 2 are counted.
    const spec: Spec = {
      id: 'hand',
      kind: 'conversation',
      channel: 'email',
      covers: ['card'],
      blocks: [{ when: { user: 'I lost my card.' }, expect: { must: ['card'] } }],
    };
    expect(measureCoverage(prepared, [spec], allowed)).toMatchObject({ t: 2, specs: 1, covered: 2 });
    expect(measureCoverage(prepared, [], allowed).covered).toBe(0);
    expect(allowed.keys.size).toBeGreaterThan(0);
  });

  it('counts a stage pair through the block that reaches the stage', () => {
    const prepared = zedPrepared();
    const allowed = allowedSet(prepared, 2);
    const spec: Spec = {
      id: 'hand',
      kind: 'conversation',
      stages: ['greet', 'verify', 'help', 'lost'],
      blocks: [{ when: { user: 'Hi' }, expect: { stage: 'verify' } }],
    };
    // stage=verify with deviation=none: the only pair, since nothing else is named.
    expect(measureCoverage(prepared, [spec], allowed).covered).toBe(1);
  });
});
