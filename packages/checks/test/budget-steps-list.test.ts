import { describe, expect, it } from 'vitest';
import { budget } from '../src/checks/budget';
import { acme } from './support/acme';
import { context, observed, run, verdict } from './support/context';

describe('budget steps evidence lists the steps in order', () => {
  it('a step count over the limit names each step in order, with the count and the limit', async () => {
    const base = acme('acme-new-customer-coverage');
    const spec = {
      ...base,
      blocks: base.blocks.map((b, i) => (i === 0 ? { ...b, budget: { steps: 2 } } : b)),
    };
    const calls = [{ label: 'coverage.check' }, { label: 'catalog.search' }, { label: 'notify_sales' }];
    const verdicts = await run(budget, context(spec, 0, observed('ok', calls)));
    const steps = verdict(verdicts, 'budget.steps');
    expect(steps.outcome).toBe('fail');
    expect(steps.evidence).toContain('3 steps (3 tool calls, 0 commands), at most 2');
    expect(steps.evidence).toContain('steps in order: 1 coverage.check, 2 catalog.search, 3 notify_sales');
  });
});
