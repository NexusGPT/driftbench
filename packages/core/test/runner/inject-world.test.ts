import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { WorldState } from '@agent-nexus/driftbench-core';
import { createPerturbingDriver, createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { injectingDriver, runSpec } from '../../src/runner';
import { specOf } from './support';

/** An adapter that records, for each message the agent receives, the world that block runs under. */
function recorder() {
  const seen: Array<{ user: string; world: WorldState }> = [];
  const adapter = functionAdapter({
    create() {},
    respond(messages, world) {
      seen.push({ user: messages.at(-1)?.content ?? '', world: structuredClone(world) });
      return { segments: [], text: 'ok', toolCalls: [], cost: {}, latencyMs: 0 };
    },
  });
  return { adapter, seen };
}

const OWN = { store: { A: 'block', B: 'block' } };
const PERTURBED = { store: { B: 'perturbation', C: 'perturbation' } };

function specWith(perturbation: Record<string, unknown>, blockWorld: WorldState | undefined) {
  return specOf({
    id: 'inject-world',
    blocks: [
      { user: 'first' },
      { user: 'second', ...(blockWorld ? { given: { world: blockWorld } } : {}) },
      { user: 'third' },
    ],
    perturbations: [{ id: 'p', class: 'D8_tool_failure', inject_at: 1, ...perturbation }],
  });
}

async function viaInjecting(spec: ReturnType<typeof specOf>) {
  const { adapter, seen } = recorder();
  const run = await runSpec(spec, {
    adapter,
    driver: injectingDriver(createScriptedDriver(), 'p'),
    checks: [],
    mode: 'P',
    repeat: 0,
    perturbationId: 'p',
  });
  expect(run.status, run.error).toBe('completed');
  return seen;
}

async function viaPerturbing(spec: ReturnType<typeof specOf>) {
  const { adapter, seen } = recorder();
  const driver = createPerturbingDriver({ spec, perturbation: 'p' });
  const run = await runSpec(driver.spec, {
    adapter,
    driver,
    checks: [],
    mode: 'P',
    repeat: 0,
    perturbationId: 'p',
  });
  expect(run.status, run.error).toBe('completed');
  return seen;
}

describe('injectingDriver: a world-only perturbation keeps the block world under its own', () => {
  const merged = { store: { A: 'block', B: 'perturbation', C: 'perturbation' } };

  it('block inject_at sees A from the block, B and C from the perturbation', async () => {
    const seen = await viaInjecting(specWith({ world: PERTURBED }, OWN));
    expect(seen.map((entry) => entry.user)).toEqual(['first', 'second', 'third']);
    expect(seen[1]?.world).toEqual(merged);
  });

  it('createPerturbingDriver gives the same world', async () => {
    const spec = specWith({ world: PERTURBED }, OWN);
    const seen = await viaPerturbing(spec);
    expect(seen[1]?.world).toEqual(merged);
    expect((await viaInjecting(spec)).map((entry) => entry.world)).toEqual(seen.map((entry) => entry.world));
  });

  it('a block without a world of its own sees the perturbation world only', async () => {
    const seen = await viaInjecting(specWith({ world: PERTURBED }, undefined));
    expect(seen[1]?.world).toEqual(PERTURBED);
  });

  it('a user perturbation is a block of its own and leaves the block world to the block', async () => {
    const seen = await viaInjecting(specWith({ user: 'wait', world: PERTURBED }, OWN));
    expect(seen.map((entry) => entry.user)).toEqual(['first', 'wait', 'second', 'third']);
    expect(seen[1]?.world).toEqual(PERTURBED);
    expect(seen[2]?.world).toEqual({ store: { A: 'block', B: 'block', C: 'perturbation' } });
  });

  it('a burst perturbation is unchanged', async () => {
    const seen = await viaInjecting(specWith({ burst: ['one', 'two'] }, OWN));
    expect(seen.map((entry) => entry.user)).toContain('second');
    expect(seen.at(-2)?.world).toEqual(OWN);
  });

  it('a spec whose blocks link by parent gives the same world', async () => {
    const spec = specOf({
      id: 'inject-world-parent',
      blocks: [
        { id: 'child', parent: 'root', user: 'child' },
        { id: 'root', user: 'root', given: { world: OWN } },
      ],
      perturbations: [{ id: 'p', class: 'D8_tool_failure', inject_at: 1, world: PERTURBED }],
    });
    const seen = await viaInjecting(spec);
    expect(seen[0]?.user).toBe('root');
    expect(seen[0]?.world).toEqual(merged);
    expect((await viaPerturbing(spec))[0]?.world).toEqual(merged);
  });
});
