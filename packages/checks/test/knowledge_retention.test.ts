import { describe, expect, it } from 'vitest';
import { knowledgeRetention } from '../src/checks/knowledge_retention';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const loose = acme('acme-order-loose-confirmation');
const ledger = { customer: 'new', name: 'Jo Okafor', email: 'jo.okafor@example.com' };
const placed =
  'Done. Your order ORD-222B51 is placed. A technician will contact you at jo.okafor@example.com to schedule the installation.';
const order = {
  label: 'order.create',
  input: {
    type: 'new',
    plan_id: 'fiber-1000',
    customer: { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
  },
};
const wants = { knowledge_retention: [{ fact: 'email', use: true }, { fact: 'name' }] };

describe('knowledge_retention', () => {
  it('passes when the email given earlier is used and neither fact is asked again', async () => {
    const ctx = context(loose, 3, observed(placed, [order]), { ledger, expect: wants });
    const verdicts = await run(knowledgeRetention, ctx);
    expect(outcomes(verdicts)).toEqual({
      'knowledge_retention.email.asked': 'pass',
      'knowledge_retention.email.used': 'pass',
      'knowledge_retention.name.asked': 'pass',
    });
    expect(verdict(verdicts, 'knowledge_retention.email.used').evidence).toBe(
      'email "jo.okafor@example.com", from the ledger, is used: in the reply, in the order.create input',
    );
  });

  it('mutation: the agent asks for the email again and drops it; asked and used both fail', async () => {
    const reask = 'Before I place it, what is your email address?';
    const ctx = context(loose, 3, observed(reask), { ledger, expect: wants });
    const verdicts = await run(knowledgeRetention, ctx);
    expect(verdict(verdicts, 'knowledge_retention.email.asked')).toMatchObject({
      outcome: 'fail',
      evidence:
        'email is in the ledger ("jo.okafor@example.com"), yet the reply asks for it again: "Before I place it, what is your email address?"',
    });
    expect(verdict(verdicts, 'knowledge_retention.email.used').outcome).toBe('fail');
    expect(verdict(verdicts, 'knowledge_retention.name.asked').outcome).toBe('pass');
  });

  it('reads a custom ask pattern, and leaves a fact missing from the ledger to the judge', async () => {
    const ctx = context(loose, 3, observed('Could you confirm how we reach you by mail?'), {
      ledger,
      expect: { knowledge_retention: [{ fact: 'email', ask: 'reach you by mail' }, { fact: 'phone' }] },
    });
    const verdicts = await run(knowledgeRetention, ctx);
    expect(verdict(verdicts, 'knowledge_retention.email.asked').outcome).toBe('fail');
    expect(verdict(verdicts, 'knowledge_retention.phone.asked')).toMatchObject({
      outcome: 'inconclusive',
      gating: false,
      evidence:
        'phone is in no ledger at this block, so no machine check can tell; the knowledge_retention criterion lets a judge decide',
    });
  });
});

describe('knowledge_retention: a judged criterion makes the ask check advisory', () => {
  it('without a judge, a question that repeats the given value is a confirmation, not a re-ask', async () => {
    const confirm = 'Just to confirm, is jo.okafor@example.com still the right email for the order?';
    const ctx = context(loose, 3, observed(confirm), {
      ledger,
      expect: { knowledge_retention: [{ fact: 'email' }] },
    });
    expect(verdict(await run(knowledgeRetention, ctx), 'knowledge_retention.email.asked')).toMatchObject({
      outcome: 'pass',
    });
  });

  it('with the judged criterion on the block, a re-ask is advisory and does not gate', async () => {
    const reask = 'Before I place it, what is your email address?';
    const ctx = context(loose, 3, observed(reask), {
      ledger,
      expect: { knowledge_retention: [{ fact: 'email' }], criteria: ['knowledge_retention'] },
    });
    expect(verdict(await run(knowledgeRetention, ctx), 'knowledge_retention.email.asked')).toMatchObject({
      outcome: 'fail',
      gating: false,
    });
  });
});
