import { describe, expect, it } from 'vitest';
import { budget } from '../src/checks/budget';
import { acme } from './support/acme';
import { type Call, context, observed, outcomes, run, verdict } from './support/context';

const loose = acme('acme-order-loose-confirmation');
const task = acme('acme-price-sheet');
const reply =
  "Hi, I'm the Acme Telecom sales assistant. Acme Fiber 1000 is available at 14 Harbor Road, Acmeville: 1000 Mbps for $60 a month.";

describe('budget', () => {
  it('passes block 0 of acme-order-loose-confirmation: cost and latency under the block budget', async () => {
    const verdicts = await run(
      budget,
      context(loose, 0, observed(reply, [], { cost: { usd: 0.004 }, latencyMs: 1200 })),
    );
    expect(outcomes(verdicts)).toEqual({ 'budget.cost_usd': 'pass', 'budget.latency_ms': 'pass' });
    expect(verdict(verdicts, 'budget.latency_ms').evidence).toBe('latency 1200 ms, at most 2000');
  });

  it('mutation: the block takes 2500 ms; budget.latency_ms fails', async () => {
    const slow = await run(
      budget,
      context(loose, 0, observed(reply, [], { cost: { usd: 0.004 }, latencyMs: 2500 })),
    );
    expect(outcomes(slow)).toEqual({ 'budget.cost_usd': 'pass', 'budget.latency_ms': 'fail' });
  });

  it('mutation: the block costs 0.02 USD; budget.cost_usd fails', async () => {
    const dear = await run(
      budget,
      context(loose, 0, observed(reply, [], { cost: { usd: 0.02 }, latencyMs: 100 })),
    );
    expect(verdict(dear, 'budget.cost_usd')).toMatchObject({
      outcome: 'fail',
      evidence: 'cost 0.02 USD, at most 0.01, over by 0.01 USD (100% above the limit)',
    });
  });

  it('names the overage at a limit of 0 as at a limit above 0', async () => {
    const free = observed(reply, [], { cost: { usd: 0.37 }, latencyMs: 470 });
    const base = context(loose, 0, free);
    const verdicts = await run(budget, {
      ...base,
      block: { ...base.block, budget: { cost_usd: 0, latency_ms: 0 } },
    });
    expect(verdict(verdicts, 'budget.cost_usd').evidence).toBe(
      'cost 0.37 USD, at most 0, over by 0.37 USD (the limit is 0)',
    );
    expect(verdict(verdicts, 'budget.latency_ms').evidence).toBe(
      'latency 470 ms, at most 0, over by 470 ms (the limit is 0)',
    );
  });

  it('counts steps on acme-price-sheet: a command seen as a tool call and an execution counts once', async () => {
    const bash = (command: string): Call => ({ label: 'Bash', input: { command } });
    const calls = Array.from({ length: 20 }, (_, index) => bash(`step ${index}`));
    const executions = calls.map((call) => ({
      command: String((call.input as { command: string }).command),
      exitCode: 0,
    }));
    const ok = await run(budget, context(task, 0, observed('Built.', calls, { executions })));
    expect(verdict(ok, 'budget.steps').evidence).toBe('20 steps (20 tool calls, 20 commands), at most 20');
    const over = await run(
      budget,
      context(task, 0, observed('Built.', [...calls, bash('one more')], { executions })),
    );
    expect(verdict(over, 'budget.steps').outcome).toBe('fail');
  });

  it('does not count the agent process (role agent) as a step', async () => {
    const commands = Array.from({ length: 20 }, (_, index) => ({
      command: `step ${index}`,
      role: 'command' as const,
      exitCode: 0,
    }));
    const agent = { command: 'acme-ops', role: 'agent' as const, exitCode: 0 };
    const verdicts = await run(
      budget,
      context(task, 0, observed('Built.', [], { executions: [...commands, agent] })),
    );
    expect(verdict(verdicts, 'budget.steps')).toMatchObject({
      outcome: 'pass',
      evidence: '20 steps (0 tool calls, 20 commands), at most 20',
    });
  });

  it('sums segment costs when the block reports none, and is inconclusive when nothing reports a cost', async () => {
    const parts = observed(reply);
    parts.cost = {};
    parts.segments = [
      { type: 'text', text: 'Hi.', cost: { usd: 0.003 } },
      { type: 'text', text: 'Fiber 1000 is available.', cost: { usd: 0.004 } },
    ];
    expect(verdict(await run(budget, context(loose, 0, parts)), 'budget.cost_usd').evidence).toBe(
      'cost 0.007 USD, at most 0.01',
    );
    const unknown = observed(reply, [], { cost: {} });
    expect(verdict(await run(budget, context(loose, 0, unknown)), 'budget.cost_usd')).toMatchObject({
      outcome: 'inconclusive',
      gating: false,
    });
  });

  it('does not apply to a block with no budget', () => {
    expect(budget.applies(context(loose, 1, observed(reply)))).toBe(false);
  });
});
