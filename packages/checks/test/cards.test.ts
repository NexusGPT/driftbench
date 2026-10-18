import type { Expect, Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { cards } from '../src/checks/cards';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const upgrade = acme('acme-plan-upgrade');
const offer =
  'Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?';
const withPicker: Expect = { ...upgrade.blocks[1]?.expect, cards: [{ name: 'plan_picker', count: 1 }] };

function withCards(seen: Observed, ...names: string[]): Observed {
  return { ...seen, segments: [...seen.segments, ...names.map((name) => ({ type: 'card' as const, name }))] };
}

describe('cards', () => {
  it('passes block 1 of acme-plan-upgrade: one text segment and the plan picker sent once', async () => {
    const ctx = context(upgrade, 1, withCards(observed(offer), 'plan_picker'), { expect: withPicker });
    const verdicts = await run(cards, ctx);
    expect(outcomes(verdicts)).toEqual({ 'cards.plan_picker': 'pass', 'cards.one_message_per_turn': 'pass' });
    expect(verdict(verdicts, 'cards.one_message_per_turn').evidence).toBe(
      'one message: one text segment "Thanks, Sam. You are on Acme Mobile S, 1...", 1 card sent once each: plan_picker',
    );
  });

  it('mutation: the reply is sent twice; one_message_per_turn fails and names both segments', async () => {
    const twice = observed(offer);
    twice.segments.push({ type: 'text', text: offer });
    const verdicts = await run(cards, context(upgrade, 1, twice));
    expect(outcomes(verdicts)).toEqual({ 'cards.one_message_per_turn': 'fail' });
    expect(verdict(verdicts, 'cards.one_message_per_turn').evidence).toMatch(
      /^2 text segments in one block: segment 0 "Thanks, Sam\..*", segment 1 "Thanks, Sam\./,
    );
  });

  it('mutation: the plan picker is sent twice; its count and the one-message rule fail', async () => {
    const ctx = context(upgrade, 1, withCards(observed(offer), 'plan_picker', 'plan_picker'), {
      expect: withPicker,
    });
    const verdicts = await run(cards, ctx);
    expect(outcomes(verdicts)).toEqual({ 'cards.plan_picker': 'fail', 'cards.one_message_per_turn': 'fail' });
    expect(verdict(verdicts, 'cards.plan_picker').evidence).toBe(
      'plan_picker sent 2 times, expected exactly 1; cards in this block: plan_picker, plan_picker',
    );
    expect(verdict(verdicts, 'cards.one_message_per_turn').evidence).toBe('card plan_picker sent 2 times');
  });

  it('takes a card in place of the text as the one message, and fails a block with no message at all', async () => {
    const cardOnly = withCards(observed(''), 'plan_picker');
    expect(outcomes(await run(cards, context(upgrade, 1, cardOnly)))).toEqual({
      'cards.one_message_per_turn': 'pass',
    });
    const silent = await run(cards, context(upgrade, 1, observed('', [{ label: 'catalog.search' }])));
    expect(verdict(silent, 'cards.one_message_per_turn').evidence).toBe(
      'no message: no text segment and no card',
    );
  });

  it('does not apply without expect.cards or rules.one_message_per_turn', () => {
    const spec = { ...upgrade, rules: {} };
    expect(cards.applies(context(spec, 1, observed(offer)))).toBe(false);
  });
});
