import {
  type AdapterCapabilities,
  canonicalGiven,
  capabilityGap,
  enterBlock,
  findSpecFiles,
  initialGiven,
  loadSpecFile,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { describe, expect, it } from 'vitest';
import { claudeCodeLiveAdapter, functionAdapter, httpAdapter, processAdapter } from '../src/index';

/**
 * The capability check over every example spec, on the adapter its run target names (an Acme spec without
 * a target runs on the Acme function agent). A shipped example must never be not_run: it would mean the
 * spec writes a layer its own target silently drops. Measured as 0 of the 2,351 example specs in H9.
 */
const CAPABILITIES: Record<string, AdapterCapabilities> = {
  function: functionAdapter({
    respond: () => ({ segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 }),
  }).capabilities(),
  http: httpAdapter({ url: 'http://127.0.0.1:9/never' }).capabilities(),
  process: processAdapter({ command: 'true', provider: localProvider() }).capabilities(),
  'claude-code': claudeCodeLiveAdapter({
    command: 'true',
    estateRoot: '.',
    provider: localProvider(),
  }).capabilities(),
};

function adapterOf(spec: Spec, path: string): string | undefined {
  if (spec.target) return spec.target.adapter;
  return path.startsWith('examples/acme/') ? 'function' : undefined;
}

/** Every gap the runner would find, in F (P adds each perturbation's world) and in T. */
function gaps(spec: Spec, adapter: string, capabilities: AdapterCapabilities): string[] {
  const out: string[] = [];
  let state = initialGiven(spec);
  let prefix = false;
  spec.blocks.forEach((block, index) => {
    state = enterBlock(state, block.given);
    prefix ||= (block.given?.prefix?.length ?? 0) > 0;
    const f = capabilityGap(adapter, capabilities, { prefix, world: state.world });
    if (f) out.push(`F block ${index}: ${f.got}`);
    const t = capabilityGap(adapter, capabilities, {
      prefix,
      world: canonicalGiven(spec, index).state.world,
    });
    if (t) out.push(`T block ${index}: ${t.got}`);
    for (const perturbation of spec.perturbations ?? []) {
      if (perturbation.inject_at !== index || !perturbation.world) continue;
      const p = capabilityGap(adapter, capabilities, {
        prefix,
        world: enterBlock(state, undefined, perturbation.world).world,
      });
      if (p) out.push(`P ${perturbation.id}: ${p.got}`);
    }
  });
  return out;
}

describe('the capability check over the shipped example specs', () => {
  it('finds no block not run on any example spec run on its own target', async () => {
    const files = await findSpecFiles(['examples']);
    const found: string[] = [];
    let checked = 0;
    for (const path of files) {
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) continue;
      const adapter = adapterOf(loaded.spec, path);
      const capabilities = adapter === undefined ? undefined : CAPABILITIES[adapter];
      if (!adapter || !capabilities) continue;
      checked += 1;
      for (const gap of gaps(loaded.spec, adapter, capabilities)) found.push(`${path} ${gap}`);
    }
    expect(found).toEqual([]);
    // The population is the shipped examples, not a handful: guards against a loader that finds nothing.
    expect(checked).toBeGreaterThan(1500);
  }, 120_000);

  it('would find one: a forced tool result on the process adapter', () => {
    const spec = {
      id: 'planted',
      kind: 'conversation',
      given: { world: { tools: { lookup: { error: 'timeout' } } } },
      blocks: [{ when: { user: 'hi' } }],
    } as Spec;
    expect(gaps(spec, 'process', CAPABILITIES.process as AdapterCapabilities)).toEqual([
      'F block 0: process declares toolStubs false: the agent would never see it',
      'T block 0: process declares toolStubs false: the agent would never see it',
    ]);
  });
});
