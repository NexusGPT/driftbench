import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { acmeSpec, loadAcmeConversations, minimalChecks, realAcmeAdapter } from './support';

const loaded = await loadAcmeConversations();
const spec = acmeSpec(loaded, 'acme-new-customer-coverage');
const driver = createScriptedDriver();

function labelsOf(run: { blocks: Array<{ observed: { toolCalls: Array<{ label: string }> } }> }): string[] {
  return [...new Set(run.blocks.flatMap((block) => block.observed.toolCalls.map((call) => call.label)))];
}

describe('runSpec with a tool policy', () => {
  it('without a policy, the recorded calls are as the adapter reported them', async () => {
    const run = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    const calls = run.blocks.flatMap((block) => block.observed.toolCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.error !== undefined)).toBe(false);
  });

  it('a deny rule marks every call of that tool, and only those calls', async () => {
    const plain = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    const [target] = labelsOf(plain);
    expect(target, 'the Acme block calls at least one tool').toBeDefined();

    const gated = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      toolPolicy: [{ pattern: target as string, action: 'deny' }],
    });
    const calls = gated.blocks.flatMap((block) => block.observed.toolCalls);
    const denied = calls.filter((call) => call.label === target);
    const others = calls.filter((call) => call.label !== target);
    expect(denied.length).toBeGreaterThan(0);
    for (const call of denied) {
      expect(call.error).toBe(`denied by tool policy rule ${target}`);
      expect(call.output).toBeUndefined();
    }
    for (const call of others) expect(call.error).toBeUndefined();
  });
});
