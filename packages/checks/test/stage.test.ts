import { describe, expect, it } from 'vitest';
import { stage } from '../src/checks/stage';
import { acme } from './support/acme';
import { context, history, observed, run } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const offer = 'Fiber is not available at 88 Summit Avenue, Acmeville yet. Would you like Acme Air 5G?';
const at = (name: string) => ({ runtime: { stages: [{ name }] } });

describe('stage', () => {
  it('passes block 1 of acme-new-customer-coverage: the runtime reports offer', async () => {
    const verdicts = await run(stage, context(coverage, 1, observed(offer, [], at('offer'))));
    expect(verdicts.map((item) => [item.id, item.outcome, item.evidence])).toEqual([
      ['stage.reached', 'pass', 'reached offer, expected offer (stages in this block: offer)'],
    ]);
  });

  it('mutation: the runtime still reports address; stage.reached fails', async () => {
    const [only] = await run(stage, context(coverage, 1, observed(offer, [], at('address'))));
    expect(only).toMatchObject({
      outcome: 'fail',
      evidence: 'reached address, expected offer (stages in this block: address)',
    });
  });

  it('reads the last stage of the block when it reports several', async () => {
    const seen = observed(offer, [], { runtime: { stages: [{ name: 'address' }, { name: 'offer' }] } });
    expect((await run(stage, context(coverage, 1, seen)))[0]?.outcome).toBe('pass');
  });

  it('keeps the last reported stage when a free-running block reports none, but not in teacher-forced mode', async () => {
    const before = history([observed('Hi.', [], at('address')), observed(offer, [], at('offer'))]);
    const quiet = context(coverage, 2, observed('Sure.', [], { runtime: {} }), {
      history: before,
      expect: { stage: 'offer' },
    });
    expect((await run(stage, quiet))[0]?.evidence).toBe(
      'reached offer, expected offer (no stage reported in this block; the last one, from block 1, still holds)',
    );
    expect(stage.applies({ ...quiet, mode: 'T' })).toBe(false);
  });

  it('does not apply when the runtime reports no stage at all: the phase 3 classifier owns that case', () => {
    expect(stage.applies(context(coverage, 1, observed(offer)))).toBe(false);
  });
});
