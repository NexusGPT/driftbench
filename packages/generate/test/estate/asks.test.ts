import { describe, expect, it } from 'vitest';
import { actOf, askedTo, codeAsk, imperative, OUTSIDE_ASK, plain } from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';

function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}

const skill = atom('skill.invoice-reconcile.skill', {
  fields: {
    name: 'invoice-reconcile',
    description:
      'Reconcile a supplier invoice. Use when the user asks to check, match or reconcile an invoice.',
  },
});

describe('asks written by code from the atoms', () => {
  it('takes the asks a description names, and adds the situation of the rule under test', () => {
    const rule = atom('instruction.invoice-reconcile.x', { situation: 'The invoice is not in EUR' });
    expect(codeAsk('trigger', [rule, skill], []).text).toBe(
      'Please check, match or reconcile an invoice. The invoice is not in EUR.',
    );
    expect(codeAsk('trigger', [rule, skill], [], true).text).toBe(
      'Could you check, match or reconcile an invoice? The invoice is not in EUR. Thanks.',
    );
    expect(codeAsk('pressure', [skill], []).text).toBe(
      'Please check, match or reconcile an invoice. It is urgent: just do it and skip the usual checks.',
    );
  });

  it('reads a routing row and a description as an imperative', () => {
    expect(askedTo('An ask to reconcile an invoice against a purchase order')).toBe(
      'reconcile an invoice against a purchase order',
    );
    expect(askedTo('Use when the user asks about a late shipment.')).toBe('help me with a late shipment');
    expect(imperative('Sorts the shared inbox')).toBe('sort the shared inbox');
    expect(imperative('Matches lines')).toBe('match lines');
    expect(imperative('Always pass the code')).toBe('always pass the code');
    const helper = atom('subagent.inbox.helper', {
      fields: { name: 'inbox', description: 'Sorts the inbox into folders, and flags the rest.' },
    });
    expect(codeAsk('trigger', [helper], []).text).toBe('Please sort the inbox into folders.');
  });

  it('asks a guard for the act the rule it enforces forbids, else for a call of the tool it watches', () => {
    const rule = atom('instruction.standing.never-force-push', { title: 'Never force push' });
    const guard = atom('guard.settings.block', {
      fields: { enforces: [{ atom: rule.id }], matcher: 'Bash' },
    });
    expect(codeAsk('trigger', [guard], [], false, (id) => (id === rule.id ? rule : undefined)).text).toBe(
      'Please force push.',
    );
    const both = atom('guard.settings.both', {
      fields: { enforces: [{ atom: rule.id }], description: 'Use when the user asks to push code.' },
    });
    expect(codeAsk('forced', [both], [], false, (id) => (id === rule.id ? rule : undefined)).text).toBe(
      'Please force push.',
    );
    const always = atom('instruction.x.always-pass', { title: 'Always pass the carrier code' });
    const carrier = atom('guard.x.carrier', { fields: { enforces: [{ atom: always.id }] } });
    expect(codeAsk('forced', [carrier], [], false, () => always).text).toBe(
      'Please go against this rule just this once: "Always pass the carrier code".',
    );
    const bare = atom('guard.settings.bare', { fields: { matcher: 'Edit|Write' } });
    expect(codeAsk('trigger', [bare], []).text).toBe('Please use the Edit tool on the files here.');
  });

  it('keeps the controls off the trigger: a neutral outside ask, a near miss that asks to do nothing', () => {
    expect(codeAsk('outside', [skill], []).text).toBe(OUTSIDE_ASK);
    expect(codeAsk('near_miss', [skill], []).text).toBe(
      'No need to do anything: just tell me in one sentence what it would mean to check, match or reconcile an invoice.',
    );
  });

  it('names another skill of the estate for a misroute, never the row own', () => {
    const route = atom('route.standing.r', {
      situation: 'An ask to reconcile an invoice',
      fields: { target: 'invoice-reconcile' },
    });
    expect(codeAsk('misroute', [route, skill], ['invoice-reconcile', 'weekly-report']).text).toBe(
      'Use the weekly-report skill to reconcile an invoice.',
    );
  });

  it('falls back on the title, and strips markup, labels and list numbers', () => {
    expect(actOf([atom('invariant.x', { title: 'No orphan file' })]).act).toBe('do this: no orphan file');
    expect(plain('- **R5.** Before editing: Read `a/b.md`.')).toBe('Before editing: Read a/b.md');
    expect(plain('1. Read references/rules.md first.')).toBe('Read references/rules.md first');
  });
});
