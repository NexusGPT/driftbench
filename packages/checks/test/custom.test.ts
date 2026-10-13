import { machineVerdict, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { CheckRegistry, createCustomCheck } from '../src/checks/custom';
import { defaultChecks } from '../src/defaults';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

/** A user check: the reply never narrates the agent's own steps. Its pattern comes from the spec. */
function registry(): CheckRegistry {
  return new CheckRegistry().register('no_narration', (ctx, options) => {
    const pattern = new RegExp(String((options as { pattern: string }).pattern), 'i');
    const hit = pattern.exec(ctx.observed.text);
    return machineVerdict(
      'no_narration',
      'reply',
      hit ? 'fail' : 'pass',
      hit ? `the reply narrates: ${JSON.stringify(hit[0])}` : 'no narration',
    );
  });
}

const spec: Spec = {
  ...acme('acme-plan-upgrade'),
  rules: { ...acme('acme-plan-upgrade').rules, custom: { no_narration: { pattern: 'let me (check|look)' } } },
};
const reply = 'Thanks, Sam. Plans with more data: Acme Mobile M and Acme Mobile L. Which one would you like?';

describe('custom', () => {
  it('passes block 1 of acme-plan-upgrade with a check registered by name through rules.custom', async () => {
    const verdicts = await run(createCustomCheck(registry()), context(spec, 1, observed(reply)));
    expect(outcomes(verdicts)).toEqual({ 'custom.no_narration.reply': 'pass' });
    expect(verdicts[0]?.kind).toBe('machine');
  });

  it('mutation: the reply narrates a lookup; the registered check fails it', async () => {
    const narrated = `Let me check your account. ${reply}`;
    const verdicts = await run(createCustomCheck(registry()), context(spec, 1, observed(narrated)));
    expect(verdict(verdicts, 'custom.no_narration.reply')).toMatchObject({
      outcome: 'fail',
      evidence: 'the reply narrates: "Let me check"',
    });
  });

  it('fails a name nobody registered, a check that throws, and a return value that is not a verdict', async () => {
    const empty = await run(createCustomCheck(new CheckRegistry()), context(spec, 1, observed(reply)));
    expect(verdict(empty, 'custom.no_narration').evidence).toBe(
      'rules.custom names no_narration, but no check of that name is registered (registered: none)',
    );
    const throwing = new CheckRegistry().register('no_narration', () => {
      throw new Error('pattern missing');
    });
    const thrown = await run(createCustomCheck(throwing), context(spec, 1, observed(reply)));
    expect(verdict(thrown, 'custom.no_narration').evidence).toBe(
      'the custom check no_narration threw: pattern missing',
    );
    const sloppy = new CheckRegistry().register('no_narration', () => ({ ok: true }) as never);
    const bad = await run(createCustomCheck(sloppy), context(spec, 1, observed(reply)));
    expect(verdict(bad, 'custom.no_narration').evidence).toMatch(
      /^the custom check no_narration returned something that is not a verdict: /,
    );
  });

  it('refuses a name registered twice, and defaultChecks resolves rules.custom from the registry it is given', async () => {
    expect(() => registry().register('no_narration', () => [])).toThrow(/already registered/);
    const checks = defaultChecks({ registry: registry() });
    const customCheck = checks.find((check) => check.name === 'custom');
    expect(customCheck).toBeDefined();
    const verdicts = await run(
      customCheck as NonNullable<typeof customCheck>,
      context(spec, 1, observed(reply)),
    );
    expect(outcomes(verdicts)).toEqual({ 'custom.no_narration.reply': 'pass' });
  });

  it('does not apply when rules.custom names nothing', () => {
    expect(
      createCustomCheck(registry()).applies(context(acme('acme-plan-upgrade'), 1, observed(reply))),
    ).toBe(false);
  });
});
