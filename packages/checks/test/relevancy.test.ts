import { describe, expect, it } from 'vitest';
import { relevancy } from '../src/checks/relevancy';
import { acme } from './support/acme';
import { context, observed, run, verdict } from './support/context';

const upgrade = acme('acme-plan-upgrade');
const ask = { user: 'Which plan gives me more data, and what does it cost per month?' };
const block = { ...upgrade.blocks[1], when: ask } as NonNullable<(typeof upgrade.blocks)[number]>;
const answer =
  'The Acme Mobile L plan gives unlimited data and costs $35 per month; Acme Mobile M gives 40 GB of data for $25 per month.';
const offTopic = 'Our stores are open Monday to Saturday, 9 am to 6 pm, and closed on Sunday.';

describe('relevancy', () => {
  it('passes a reply that holds the key terms of the ask, with the share as its score', async () => {
    const ctx = context(upgrade, 1, observed(answer), { block, expect: { relevancy: {} } });
    const [only] = await run(relevancy, ctx);
    expect(only).toMatchObject({ id: 'relevancy.terms', outcome: 'pass', score: 1 });
    expect(only?.evidence).toBe(
      '4 of 4 key terms of the ask are in the reply (plan, data, cost, month), at least 50% expected',
    );
  });

  it('mutation: the reply talks about store hours; it fails and names the missing terms', async () => {
    const ctx = context(upgrade, 1, observed(offTopic), { block, expect: { relevancy: {} } });
    expect(verdict(await run(relevancy, ctx), 'relevancy.terms')).toMatchObject({
      outcome: 'fail',
      score: 0,
      evidence:
        '0 of 4 key terms of the ask are in the reply; missing: plan, data, cost, month; at least 50% expected',
    });
  });

  it('takes the terms the spec gives, and is inconclusive when the ask holds no key term', async () => {
    const given = context(upgrade, 1, observed(answer), {
      block,
      expect: { relevancy: { terms: ['roaming', 'data'], min: 1 } },
    });
    expect((await run(relevancy, given))[0]).toMatchObject({ outcome: 'inconclusive', gating: false });
    const bare = context(upgrade, 1, observed(answer), {
      block: { ...block, when: { user: 'Yes, ok.' } },
      expect: { relevancy: {} },
    });
    expect((await run(relevancy, bare))[0]).toMatchObject({ outcome: 'inconclusive', gating: false });
  });

  it('without a judge: one key term of four is inconclusive, not a failure, and does not gate', async () => {
    const partial = 'The Mobile L is our unlimited tier at thirty-five dollars monthly.';
    const ctx = context(upgrade, 1, observed(partial), { block, expect: { relevancy: {} } });
    expect(verdict(await run(relevancy, ctx), 'relevancy.terms')).toMatchObject({
      outcome: 'inconclusive',
      gating: false,
    });
  });

  it('with a judged relevancy criterion: a low share is advisory and does not gate', async () => {
    const partial = 'The Mobile L is our unlimited tier at thirty-five dollars monthly.';
    const ctx = context(upgrade, 1, observed(partial), {
      block,
      expect: { relevancy: {}, criteria: ['relevancy'] },
    });
    expect(verdict(await run(relevancy, ctx), 'relevancy.terms')).toMatchObject({
      outcome: 'fail',
      gating: false,
    });
  });
});
