import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
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
  const adapter = echoAdapter('broken');
  const run = await runSpec(spec, {
    ...options,
    target: { ...options.target, variant: 'v2' },
    adapter,
    mode: 'T',
    blocks: new Set([1]),
    blockReuse: {
      source,
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
