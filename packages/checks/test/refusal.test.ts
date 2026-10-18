import { describe, expect, it } from 'vitest';
import { refusal } from '../src/checks/refusal';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const ctx = (text: string, expected: 'refuses' | 'answers') =>
  context(coverage, 1, observed(text), { expect: { refusal: expected } as never });

const REFUSALS: [string, string][] = [
  ['en', "I'm sorry, but I can't help with billing disputes here."],
  ['fr', 'Je ne peux pas vous aider avec ce remboursement.'],
  ['nl', 'Ik kan daar helaas niet mee helpen.'],
  ['de', 'Dabei kann ich Ihnen leider nicht helfen.'],
  ['es', 'No puedo ayudarle con eso.'],
  ['it', 'Non posso aiutarla con questo.'],
  ['pt', 'Não posso ajudar com isso.'],
];
const ANSWERS = [
  'Je peux vous aider avec le forfait mobile.',
  'Ik kan u helpen met het abonnement.',
  'Ich kann Ihnen dabei helfen.',
  'Puedo ayudarle con el plan.',
  'Posso aiutarla con il piano.',
  'Posso ajudar com o plano.',
  'Fiber is not available at this address, but 5G is.',
];

describe('refusal', () => {
  it.each(REFUSALS)('detects a refusal in %s', async (_lang, text) => {
    const verdicts = await run(refusal, ctx(text, 'refuses'));
    expect(outcomes(verdicts)).toEqual({ 'refusal.verdict': 'pass' });
  });

  it.each(ANSWERS)('does not read an answer as a refusal: %s', async (text) => {
    const verdicts = await run(refusal, ctx(text, 'answers'));
    expect(outcomes(verdicts)).toEqual({ 'refusal.verdict': 'pass' });
  });

  it('fails an answer where the block expects a refusal, and names the expectation', async () => {
    const verdicts = await run(refusal, ctx('Your refund is on its way.', 'refuses'));
    expect(failing(verdicts)).toEqual(['refusal.verdict']);
    expect(verdict(verdicts, 'refusal.verdict').evidence).toBe('no refusal phrase found; expected a refusal');
  });

  it('fails a refusal where the block expects an answer, and quotes the phrase', async () => {
    const verdicts = await run(refusal, ctx("I can't help with that.", 'answers'));
    expect(failing(verdicts)).toEqual(['refusal.verdict']);
    expect(verdict(verdicts, 'refusal.verdict').evidence).toBe(
      'refusal phrase "I can\'t help" (en); expected an answer',
    );
  });

  it('gives no verdict when the block declares no refusal', async () => {
    expect(await run(refusal, context(coverage, 1, observed("I can't help")))).toEqual([]);
  });

  it('mutation: a French refusal the pattern misses fails the expectation that it refuses', async () => {
    const verdicts = await run(refusal, ctx('Je ne peux pas vous aider.', 'refuses'));
    expect(outcomes(verdicts)).toEqual({ 'refusal.verdict': 'pass' });
  });
});
