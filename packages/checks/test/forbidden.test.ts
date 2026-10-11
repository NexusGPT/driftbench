import { describe, expect, it } from 'vitest';
import { forbidden } from '../src/checks/forbidden';
import { acme } from './support/acme';
import { context, failing, history, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const greeting =
  "Hi, I'm the Acme Telecom sales assistant. I can check what is available at your address. What is the street address?";

describe('forbidden', () => {
  it('passes block 0 of acme-new-customer-coverage: no forbidden tool, nothing expected 0 times, caps held', async () => {
    const verdicts = await run(forbidden, context(coverage, 0, observed(greeting)));
    expect(outcomes(verdicts)).toEqual({
      'forbidden.order.create': 'pass',
      'forbidden.port.check': 'pass',
      'forbidden.coverage.check': 'pass',
      'forbidden.catalog.search': 'pass',
      'forbidden.max_calls.coverage.check': 'pass',
      'forbidden.max_calls.catalog.search': 'pass',
      'forbidden.max_calls.notify_sales': 'pass',
    });
    expect(verdict(verdicts, 'forbidden.port.check').evidence).toBe(
      'port.check not called (forbidden by rules.forbidden_tools)',
    );
  });

  it('mutation: coverage.check called in block 0, which expects it 0 times, fails forbidden.coverage.check', async () => {
    const early = observed(greeting, [{ label: 'coverage.check', input: { address: '88 Summit Avenue' } }]);
    const verdicts = await run(forbidden, context(coverage, 0, early));
    expect(failing(verdicts)).toEqual(['forbidden.coverage.check']);
    expect(verdict(verdicts, 'forbidden.coverage.check').evidence).toBe(
      'coverage.check called 1 time (call-1); the block expects it 0 times',
    );
  });

  it('mutation: port.check called anywhere fails the rules.forbidden_tools verdict', async () => {
    const verdicts = await run(forbidden, context(coverage, 2, observed('Sure.', [{ label: 'port.check' }])));
    expect(failing(verdicts)).toEqual(['forbidden.port.check']);
  });

  it('reads rules.max_calls at 0 as forbidden: acme-off-topic-return never books a callback', async () => {
    const spec = acme('acme-off-topic-return');
    const verdicts = await run(forbidden, context(spec, 4, observed('Done.', [{ label: 'notify_sales' }])));
    expect(verdict(verdicts, 'forbidden.notify_sales').evidence).toBe(
      'notify_sales called 1 time (call-1); rules.max_calls is 0',
    );
    expect(verdicts.some((item) => item.id === 'forbidden.max_calls.notify_sales')).toBe(false);
  });

  it('counts rules.max_calls across the run: a second coverage.check fails the block that makes it', async () => {
    const check = { label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } };
    const before = history([observed(greeting), observed('Fiber is not available.', [check])]);
    const again = await run(
      forbidden,
      context(coverage, 2, observed('Let me check.', [check]), { history: before }),
    );
    expect(verdict(again, 'forbidden.max_calls.coverage.check')).toMatchObject({
      outcome: 'fail',
      evidence:
        'coverage.check ran 2 times in the run so far (1 in this block, 1 before), at most 1 by rules.max_calls',
    });
    const quiet = await run(forbidden, context(coverage, 2, observed('Sure.'), { history: before }));
    expect(verdict(quiet, 'forbidden.max_calls.coverage.check').outcome).toBe('pass');
  });

  it('does not apply to a spec with no rules and a block with no tool expected 0 times', () => {
    const plain = { ...coverage, rules: undefined };
    expect(forbidden.applies(context(plain, 1, observed('ok')))).toBe(false);
  });
});
