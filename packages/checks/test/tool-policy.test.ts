import { describe, expect, it } from 'vitest';
import { createToolPolicyCheck } from '../src/checks/tool-policy';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const reply = 'Thanks, I have noted that.';

describe('tool_policy', () => {
  it('does not apply when no rule is given: the default checks are unchanged', () => {
    const check = createToolPolicyCheck([]);
    expect(check.applies(context(coverage, 0, observed(reply, [{ label: 'send_email' }])))).toBe(false);
  });

  it('fails a call the deny rule matches, and names the rule and the call', async () => {
    const check = createToolPolicyCheck([{ pattern: 'send_*', action: 'deny' }]);
    const calls = [{ label: 'send_email', input: { to: 'x' }, id: 'c1' }];
    const verdicts = await run(check, context(coverage, 0, observed(reply, calls)));
    expect(failing(verdicts)).toEqual(['tool_policy.send_email']);
    expect(verdict(verdicts, 'tool_policy.send_email').evidence).toContain('denied by rule send_*');
  });

  it('passes a call the allow rule matches, and a call no rule matches', async () => {
    const check = createToolPolicyCheck([
      { pattern: 'read_*', action: 'allow' },
      { pattern: 'send_*', action: 'deny' },
    ]);
    const verdicts = await run(check, context(coverage, 0, observed(reply, [{ label: 'read_file' }])));
    expect(failing(verdicts)).toEqual([]);
    expect(outcomes(verdicts)).toEqual({ 'tool_policy.calls': 'pass' });
  });

  it('treats an ask rule as a denial, since a check has no approver', async () => {
    const check = createToolPolicyCheck([{ pattern: 'delete_*', action: 'ask' }]);
    const verdicts = await run(check, context(coverage, 0, observed(reply, [{ label: 'delete_row' }])));
    expect(failing(verdicts)).toEqual(['tool_policy.delete_row']);
    expect(verdict(verdicts, 'tool_policy.delete_row').evidence).toContain('no approver');
  });

  it('matches the whole tool name: a deny on send does not match send_email', async () => {
    const check = createToolPolicyCheck([{ pattern: 'send', action: 'deny' }]);
    const verdicts = await run(check, context(coverage, 0, observed(reply, [{ label: 'send_email' }])));
    expect(failing(verdicts)).toEqual([]);
  });

  it('the first matching rule decides', async () => {
    const check = createToolPolicyCheck([
      { pattern: 'send_*', action: 'allow' },
      { pattern: 'send_*', action: 'deny' },
    ]);
    const verdicts = await run(check, context(coverage, 0, observed(reply, [{ label: 'send_email' }])));
    expect(failing(verdicts)).toEqual([]);
  });
});
