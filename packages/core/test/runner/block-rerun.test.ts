import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { adapterProvenance, provenanceDigest, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, minimalChecks, specOf } from './support';

const spec = specOf({
  id: 'acme-blocks',
  metadata: { depends: {} },
  blocks: [
    { when: { user: 'one' }, expect: { stage: 'one', must: ['ok'] } },
    { when: { user: 'two' }, expect: { stage: 'two', must: ['ok'] } },
    { when: { user: 'three' }, expect: { stage: 'three', must: ['ok'] } },
  ],
});
const options = {
  driver: createScriptedDriver(),
  checks: minimalChecks.filter((c) => c.name !== 'stage'),
  repeat: 0,
  target: { adapter: 'echo', variant: 'v1' },
  recordProvenance: true,
  now: () => new Date('2026-10-13T00:00:00Z'),
};
it('runs a T block alone from its canonical Given and refuses F and P subsets', async () => {
  const adapter = echoAdapter();
  const run = await runSpec(spec, { ...options, adapter, mode: 'T', blocks: new Set([1]) });
  expect(run.blocks.map((b) => b.index)).toEqual([1]);
  expect(adapter.opened).toHaveLength(1);
  expect(adapter.opened[0]?.prefix).toHaveLength(2);
  for (const mode of ['F', 'P'] as const)
    await expect(runSpec(spec, { ...options, adapter, mode, blocks: new Set([1]) })).rejects.toThrow(
      /mode T/,
    );
});
it('carries independent downstream T blocks but reruns a planted regression in the changed block', async () => {
  const source = await runSpec(spec, { ...options, adapter: echoAdapter(), mode: 'T' });
  const adapter = echoAdapter('regression');
  const run = await runSpec(spec, {
    ...options,
    target: { ...options.target, variant: 'v2' },
    adapter,
    mode: 'T',
    blocks: new Set([1]),
    blockReuse: {
      source,
      baselineProvenance: {
        version: 2,
        adapters: [
          {
            ...adapterProvenance(echoAdapter()),
            targetHash: provenanceHash(options.target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      fromCampaign: 'base',
      manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'two' }] },
    },
  });
  expect(adapter.opened).toHaveLength(1);
  expect(run.blocks).toHaveLength(3);
  expect(run.blocks[1]?.pass).toBe(false);
  expect(run.blocks[2]?.carried).toBeDefined();
  expect(run.blockRerun?.reason).toContain('canonical Given');
  expect(run.blockRerun?.downstreamNotRerun).toEqual([2]);
});

const campaignStamp = (adapter: ReturnType<typeof echoAdapter>) => ({
  version: 2 as const,
  adapters: [
    {
      ...adapterProvenance(adapter),
      targetHash: provenanceHash(options.target),
      agentVersionHash: provenanceHash('v1'),
    },
  ],
});
const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'stage' as const, id: 'two' }] };
function stateAdapter(bad = false) {
  const adapter = echoAdapter();
  return {
    ...adapter,
    capabilities: () => ({ ...adapter.capabilities(), endState: true }),
    endState: async (session: { given: { prefix: unknown[] } }) =>
      session.given.prefix.length === 2 ? { value: bad ? 'regression' : 'ok' } : null,
  };
}
it('defaults to full cell without snapshots and recomposes the final carried block verdict with snapshots', async () => {
  const withEnd = specOf({ ...spec, end_state: { source: 'tool:acme', expect: { value: 'ok' } } });
  const adapter = stateAdapter();
  const full = await runSpec(withEnd, {
    ...options,
    adapter,
    mode: 'T',
    checks: defaultChecks(),
    recordEndStateSnapshots: true,
  });
  const plain = await runSpec(withEnd, { ...options, adapter, mode: 'T', checks: defaultChecks() });
  expect(plain.blocks.every((b) => b.provenance?.endState === undefined)).toBe(true);
  for (const bad of [false, true]) {
    const current = stateAdapter(bad);
    const currentOptions = {
      ...options,
      adapter: current,
      target: { ...options.target, variant: 'v2' },
      mode: 'T' as const,
      checks: defaultChecks(),
      recordEndStateSnapshots: true,
    };
    const expected = await runSpec(withEnd, currentOptions);
    current.opened.length = 0;
    const mixed = await runSpec(withEnd, {
      ...currentOptions,
      blockReuse: {
        source: full,
        fromCampaign: 'base',
        baselineProvenance: campaignStamp(adapter),
        manifest,
      },
    });
    expect(current.opened).toHaveLength(1);
    expect(JSON.stringify(mixed.endState)).toBe(JSON.stringify(expected.endState));
    expect(JSON.stringify(mixed.blocks[2]?.verdicts)).toBe(JSON.stringify(expected.blocks[2]?.verdicts));
    expect(mixed.blocks[2]?.pass).toBe(!bad);
    expect(mixed.blocks[2]?.carried).toBeDefined();
  }
  const fallbackAdapter = stateAdapter(true);
  const fallback = await runSpec(withEnd, {
    ...options,
    adapter: fallbackAdapter,
    mode: 'T',
    target: { ...options.target, variant: 'v2' },
    checks: defaultChecks(),
    blockReuse: { source: plain, fromCampaign: 'base', baselineProvenance: campaignStamp(adapter), manifest },
  });
  expect(fallbackAdapter.opened).toHaveLength(3);
  expect(fallback.blockRerun?.reason).toBe('end state cannot be recomposed: full cell rerun');
  expect(fallback.endState?.match).toBe(false);
});

it.each([false, true])('partial block copies follow recordRealizedText (%s)', async (recordRealizedText) => {
  const source = await runSpec(spec, { ...options, adapter: echoAdapter(), mode: 'T' });
  // Exercise the copy boundary with stamped recorded blocks, including empty text.
  for (const [index, block] of source.blocks.entries())
    block.realized = {
      hash: provenanceHash(index === 0 ? '' : 'private'),
      text: index === 0 ? '' : 'private',
    };
  source.provenanceDigest = provenanceDigest(source);
  const before = structuredClone(source);
  const adapter = echoAdapter();
  const result = await runSpec(spec, {
    ...options,
    adapter,
    mode: 'T',
    target: { ...options.target, variant: 'v2' },
    recordRealizedText,
    blockReuse: { source, fromCampaign: 'base', baselineProvenance: campaignStamp(adapter), manifest },
  });
  expect(adapter.opened).toHaveLength(1);
  for (const index of [0, 2]) {
    const block = result.blocks[index];
    if (!block) throw new Error('missing copied block');
    expect(block.carried).toBeDefined();
    expect(block.realized).toEqual({
      hash: source.blocks[index]?.realized?.hash,
      ...(recordRealizedText ? { text: source.blocks[index]?.realized?.text } : {}),
    });
    if (!recordRealizedText)
      expect(block.realizedTextStripped).toEqual({ fromRun: source.runId, fromCampaign: 'base' });
  }
  expect(result.blocks[1]?.carried).toBeUndefined();
  expect(result.provenanceDigest).toBe(provenanceDigest(result));
  expect(source).toEqual(before);
});
