import { describe, expect, it, vi } from 'vitest';
import { feedFromConditions } from '../../src/feed/conditions';
import { fixtureStore } from './support';
import { round3Options, round3Systems } from '../../../../examples/variables/conditions/round3';

const clause = 'If the parcel is more than 48 hours late, open a claim.';
const question = {
  name: 'delay/over_one_day',
  kind: 'yesno' as const,
  yes: 'yes',
  no: 'no',
  text: round3Options.questionText(
    { title: 'Shipment delay' },
    { title: 'A shipment is more than one day late' },
  ),
};
const port = { family: 'fictional', complete: vi.fn(async () => 'null') };

describe('a system-1 numeric-guard veto on a candidate yes', () => {
  it('rejects an implied broader range when the independent guard vote finds a mismatch', async () => {
    const judge = vi.fn(async () => ({ answer: { outcome: 'pass', score: 0.9 } }));
    const { reader } = round3Systems({ id: 'fixture', cls: 'system1', family: 'fictional', judge }, port, [
      { id: 's', path: 'fictional.md', quote: clause },
    ]);
    expect(await reader.read(clause, [question])).toEqual({ 'delay/over_one_day': { yes: 0 } });
    expect(judge).toHaveBeenCalledTimes(2);
    expect(port.complete).not.toHaveBeenCalled();
  });

  it('keeps a valid yes when no material numeric mismatch is found', async () => {
    const judge = vi.fn(async (request: { criterion: { name: string } }) => ({
      answer: {
        outcome: 'pass',
        score: request.criterion.name.startsWith('numeric_guard_mismatch:') ? 0.05 : 0.9,
      },
    }));
    const { reader } = round3Systems({ id: 'fixture', cls: 'system1', family: 'fictional', judge }, port, []);
    const categorical = { ...question, name: 'helper/died',
      text: round3Options.questionText({ title: 'Helper outcome' }, { title: 'A helper agent died' }) };
    expect(await reader.read('A helper agent died', [categorical])).toEqual({
      'helper/died': { yes: 0.9 },
    });
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed veto unread instead of inventing a no that would permit a proposal', async () => {
    const judge = vi.fn(async (request: { criterion: { name: string } }) =>
      request.criterion.name.startsWith('numeric_guard_mismatch:')
        ? { answer: { outcome: 'inconclusive' }, unparsed: true }
        : { answer: { outcome: 'pass', score: 0.9 } },
    );
    const { reader } = round3Systems({ id: 'fixture', cls: 'system1', family: 'fictional', judge }, port, []);
    expect(await reader.read(clause, [question])).toEqual({ 'delay/over_one_day': undefined });
    const systems = round3Systems({ id: 'fixture', cls: 'system1', family: 'fictional', judge }, port,
      [{ id: 's', path: 'fictional.md', quote: clause }]);
    const result = await feedFromConditions({
      store: fixtureStore(), spans: [{ id: 's', path: 'fictional.md', quote: clause }],
      texts: new Map([['fictional.md', clause]]), ...systems, options: round3Options,
    });
    expect(result.report.outcomes).toMatchObject([{ status: 'unsure', values: [] }]);
    expect(result.report.proposerCalls).toBe(0);
  });
});
