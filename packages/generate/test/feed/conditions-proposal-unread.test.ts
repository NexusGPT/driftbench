// The ten source/proposal cases from independent red run 39606068020.
// Assertions and judge behavior retained; formatting applied by GitHub Biome.
import { expect, it, vi } from 'vitest';
import { round3Options, round3Systems } from '../../../../examples/variables/conditions/round3';
import { feedFromConditions } from '../../src/feed/conditions';
import type { ConditionJudge } from '../../src/feed/judge-reader';
import { fixtureStore } from './support';

const clause = 'When the fictional parcel is held for inspection, notify its keeper.';
const title = 'the parcel is held for inspection';
const proposal = JSON.stringify({
  variable: { id: 'shipment_state', title: 'Ignored model title' },
  value: { id: 'inspection', title },
});
const spans = [{ id: 'review1', path: 'fictional.md', quote: clause }];
const good = (score: number) => ({ answer: { outcome: 'pass', score } });
const invalid = () => ({ answer: { outcome: 'inconclusive' }, unparsed: true });
const input = (systems: ReturnType<typeof round3Systems>) => ({
  store: fixtureStore(),
  spans,
  texts: new Map([['fictional.md', clause]]),
  ...systems,
  options: round3Options,
});

for (const mode of [
  'malformed-primary',
  'throw-primary',
  'malformed-mismatch',
  'malformed-numeric',
] as const) {
  it(`source read ${mode} remains unsettled and never calls the proposer`, async () => {
    const judge = vi.fn(async (r: Parameters<ConditionJudge['judge']>[0]) => {
      if (mode === 'throw-primary' && !r.criterion.name.includes(':')) throw new Error('fictional failure');
      if (mode === 'malformed-primary' && !r.criterion.name.includes(':')) return invalid();
      if (r.criterion.name.startsWith('condition_mismatch:'))
        return mode === 'malformed-mismatch' ? invalid() : good(0);
      if (r.criterion.name.startsWith('guard_parameters_equal:'))
        return mode === 'malformed-numeric' ? invalid() : good(1);
      return good(1);
    });
    const complete = vi.fn(async () => proposal);
    const result = await feedFromConditions(
      input(
        round3Systems(
          { id: 'fake', cls: 'system1', family: 'fictional', judge },
          { family: 'fictional', complete },
          spans,
        ),
      ),
    );
    expect(result.report.outcomes).toMatchObject([{ status: 'unsure', values: [] }]);
    expect(complete).not.toHaveBeenCalled();
  });
}

for (const mode of [
  'malformed-description',
  'throw-description',
  'malformed-description-mismatch',
  'malformed-description-numeric',
] as const) {
  it(`proposal check ${mode} cannot admit a new value`, async () => {
    const judge = vi.fn(async (r: Parameters<ConditionJudge['judge']>[0]) => {
      const text = r.transcript[0]?.text ?? '';
      const description = text === title || text.includes(JSON.stringify(title));
      if (!description) return good(0); // source candidates are all decided no
      if (r.criterion.name.startsWith('condition_mismatch:'))
        return mode === 'malformed-description-mismatch' ? invalid() : good(0);
      if (r.criterion.name.startsWith('guard_parameters_equal:'))
        return mode === 'malformed-description-numeric' ? invalid() : good(1);
      if (mode === 'malformed-description') return invalid();
      if (mode === 'throw-description') throw new Error('fictional outage after proposal');
      return good(1);
    });
    const result = await feedFromConditions(
      input(
        round3Systems(
          { id: 'fake', cls: 'system1', family: 'fictional', judge },
          { family: 'fictional', complete: async () => proposal },
          spans,
        ),
      ),
    );
    console.log('post-proposal', mode, JSON.stringify(result.report.outcomes));
    expect(result.report.outcomes[0]?.status).toBe('unsure');
    expect(
      result.store.variables
        .find((v) => v.id === 'shipment_state')
        ?.values.some((v) => v.id === 'inspection'),
    ).toBe(false);
  });
}

it('control: a proposal checked as no against every existing candidate can enter unapproved with its exact quote', async () => {
  const systems = round3Systems(
    { id: 'fake', cls: 'system1', family: 'fictional', judge: async () => good(0) },
    { family: 'fictional', complete: async () => proposal },
    spans,
  );
  const result = await feedFromConditions(input(systems));
  expect(result.report.outcomes).toMatchObject([
    { status: 'proposed', values: ['shipment_state/inspection'] },
  ]);
  expect(
    result.store.variables.find((v) => v.id === 'shipment_state')?.values.find((v) => v.id === 'inspection'),
  ).toMatchObject({ approved: false, provenance: [{ kind: 'quote', path: 'fictional.md', quote: clause }] });
});

it('control: a proposal checked as yes reuses the existing value', async () => {
  const judge = async (r: Parameters<ConditionJudge['judge']>[0]) => {
    if (r.criterion.name.startsWith('condition_mismatch:')) return good(0);
    if (r.criterion.name.startsWith('guard_parameters_equal:')) return good(1);
    return good(r.transcript[0]?.text === title && r.criterion.name === 'shipment_state/late' ? 1 : 0);
  };
  const result = await feedFromConditions(
    input(
      round3Systems(
        { id: 'fake', cls: 'system1', family: 'fictional', judge },
        { family: 'fictional', complete: async () => proposal },
        spans,
      ),
    ),
  );
  expect(result.report.outcomes).toMatchObject([{ status: 'matched', values: ['shipment_state/late'] }]);
});

for (const checkProposals of ['match', 'refuse'] as const) {
  for (const failure of ['unsure', 'throw'] as const) {
    it(`blocks a direct ${failure} description read with ${checkProposals}`, async () => {
      const result = await feedFromConditions({
        store: fixtureStore(),
        spans,
        texts: new Map([['fictional.md', clause]]),
        reader: {
          id: 'direct-failure',
          family: 'fictional',
          async read(text, questions) {
            if (text === title && failure === 'throw') throw new Error('fictional failure');
            return Object.fromEntries(questions.map((q) => [q.name, { yes: text === title ? 0.5 : 0 }]));
          },
        },
        proposer: {
          id: 'fictional',
          async propose() {
            return JSON.parse(proposal);
          },
        },
        options: { checkProposals, newVariables: false },
      });
      expect(result.report.outcomes).toMatchObject([{ status: 'unsure', values: [] }]);
      expect(result.store).toEqual(fixtureStore());
    });
  }
}
