import { describe, expect, it } from 'vitest';
import { toolF1 } from '../src/checks/tool_f1';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const ctx = (calls: { label: string; input?: unknown }[], tools: unknown[], min: number) =>
  context(coverage, 1, observed('', calls), { expect: { tools, tool_f1: { min } } as never });

describe('tool_f1', () => {
  it('scores an exact match of the expected calls as 1', async () => {
    const verdicts = await run(
      toolF1,
      ctx([{ label: 'coverage.check' }], [{ label: 'coverage.check', count: 1 }], 1),
    );
    expect(outcomes(verdicts)).toEqual({ 'tool_f1.f1': 'pass' });
    expect(verdict(verdicts, 'tool_f1.f1').evidence).toBe(
      'precision 1.00 (1 of 1 calls), recall 1.00 (1 of 1 expected), F1 1.00, minimum 1.00',
    );
  });

  it('fails an extra call that was not expected, and names it', async () => {
    const verdicts = await run(
      toolF1,
      ctx(
        [{ label: 'coverage.check' }, { label: 'email.send' }],
        [{ label: 'coverage.check', count: 1 }],
        0.9,
      ),
    );
    expect(outcomes(verdicts)).toEqual({ 'tool_f1.f1': 'fail' });
    expect(verdict(verdicts, 'tool_f1.f1').evidence).toContain('precision 0.50 (1 of 2 calls)');
    expect(verdict(verdicts, 'tool_f1.f1').evidence).toContain('unexpected: email.send');
  });

  it('fails a missed expected call and reports the recall', async () => {
    const verdicts = await run(
      toolF1,
      ctx(
        [{ label: 'coverage.check' }],
        [
          { label: 'coverage.check', count: 1 },
          { label: 'order.create', count: 1 },
        ],
        0.9,
      ),
    );
    expect(outcomes(verdicts)).toEqual({ 'tool_f1.f1': 'fail' });
    expect(verdict(verdicts, 'tool_f1.f1').evidence).toContain('recall 0.50 (1 of 2 expected)');
    expect(verdict(verdicts, 'tool_f1.f1').evidence).toContain('missed: order.create');
  });

  it('matches arguments: a call with the wrong plan is not the expected call', async () => {
    const tools = [{ label: 'catalog.search', count: 1, input: { plan: { exact: 'mobile' } } }];
    const right = await run(toolF1, ctx([{ label: 'catalog.search', input: { plan: 'mobile' } }], tools, 1));
    const wrong = await run(toolF1, ctx([{ label: 'catalog.search', input: { plan: 'home' } }], tools, 1));
    expect(outcomes(right)).toEqual({ 'tool_f1.f1': 'pass' });
    expect(outcomes(wrong)).toEqual({ 'tool_f1.f1': 'fail' });
  });

  it('scores a block with no expected calls and no calls as 1', async () => {
    const verdicts = await run(toolF1, ctx([], [], 1));
    expect(outcomes(verdicts)).toEqual({ 'tool_f1.f1': 'pass' });
  });

  it('gives no verdict when the block declares no tool_f1', async () => {
    expect(await run(toolF1, context(coverage, 1, observed('', [{ label: 'x' }])))).toEqual([]);
  });

  it('mutation: ignoring arguments passes the wrong plan that argument matching fails', async () => {
    const tools = [{ label: 'catalog.search', count: 1, input: { plan: { exact: 'mobile' } } }];
    const verdicts = await run(toolF1, ctx([{ label: 'catalog.search', input: { plan: 'home' } }], tools, 1));
    expect(outcomes(verdicts)).toEqual({ 'tool_f1.f1': 'fail' });
  });
});
