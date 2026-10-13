import { describe, expect, it } from 'vitest';
import { stage } from '../src/checks/stage';
import { acme } from './support/acme';
import { context, history, observed, outcomes, run } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const offer = 'Fiber is not available at 88 Summit Avenue, Acmeville yet. Would you like Acme Air 5G?';
const at = (name: string) => ({ runtime: { stages: [{ name }] } });

describe('stage', () => {
  it('mutation: removing this block stage report fails even when history supplies the expected stage', async () => {
    const before = history([observed('Ready.', [], at('offer'))]);
    for (const mode of ['T', 'F', 'P'] as const) {
      const ctx = context(coverage, 1, observed(offer, [], at('offer')), {
        mode,
        history: before,
        expect: { stage: 'offer', stage_reported: true },
      });
      expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'pass', 'stage.reached': 'pass' });
      const removed = await run(stage, { ...ctx, observed: observed(offer) });
      expect(removed.find((entry) => entry.id === 'stage.reported')).toMatchObject({
        gating: true,
        outcome: 'fail',
      });
      expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'pass', 'stage.reached': 'pass' });
    }
  });

  it('requires a report independently of the stage name and refuses empty reports', async () => {
    for (const runtime of [undefined, {}, { stages: [] }, { stages: [{ name: '' }, { name: '  ' }] }]) {
      const ctx = context(coverage, 1, observed(offer, [], { runtime }), {
        expect: { stage_reported: true },
      });
      expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'fail' });
    }
    const ctx = context(coverage, 1, observed(offer, [], at('offer')), {
      expect: { stage_reported: true },
    });
    expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'pass' });
  });

  it('false or omitted reporting flags leave the old stage behavior unchanged', async () => {
    const before = history([observed('Ready.', [], at('offer'))]);
    const ctx = context(coverage, 1, observed(offer), { history: before, expect: { stage: 'offer' } });
    expect(await run(stage, { ...ctx, expect: { ...ctx.expect, stage_reported: false } })).toEqual(
      await run(stage, ctx),
    );
    expect(stage.applies({ ...ctx, history: [], expect: { stage_reported: false } })).toBe(false);
  });

  it('a carried runtime entry cannot satisfy reporting, but still supplies the reached stage', async () => {
    const carried = { runtime: { stages: [{ name: 'offer', carried: true }] } };
    for (const mode of ['T', 'F', 'P'] as const) {
      const ctx = context(coverage, 1, observed(offer, [], carried), {
        mode,
        expect: { stage: 'offer', stage_reported: true },
      });
      expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'fail', 'stage.reached': 'pass' });
      for (const flag of [undefined, false]) {
        const legacy = {
          ...ctx,
          expect: { stage: 'offer', ...(flag === undefined ? {} : { stage_reported: flag }) },
        };
        expect(await run(stage, legacy)).toEqual(
          await run(stage, { ...legacy, observed: observed(offer, [], at('offer')) }),
        );
      }
    }
  });

  it('counts a current stage alongside carried stages, including an explicit false carried flag', async () => {
    for (const carried of [undefined, false]) {
      const runtime = {
        stages: [
          { name: 'address', carried: true },
          { name: 'offer', ...(carried === undefined ? {} : { carried }) },
        ],
      };
      const ctx = context(coverage, 1, observed(offer, [], { runtime }), {
        expect: { stage: 'offer', stage_reported: true },
      });
      expect(outcomes(await run(stage, ctx))).toEqual({ 'stage.reported': 'pass', 'stage.reached': 'pass' });
    }
  });

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
