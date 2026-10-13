import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { captureArtifacts, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from './support';

const spec = specOf({
  id: 'acme-provenance',
  blocks: [{ when: { user: 'hello' }, expect: { ledger_add: { plan: 'Acme' } } }],
});
it('records the actual stimulus, check inputs and driver only when requested', async () => {
  const driver = {
    ...createScriptedDriver(),
    seeds: { sample: 17 },
    next: (ctx: Parameters<ReturnType<typeof createScriptedDriver>['next']>[0]) =>
      ctx.blockIndex > 0
        ? { kind: 'stop' as const, reason: 'done' }
        : { kind: 'block' as const, blockIndex: 0, stimulus: { user: 'actual user text' } },
  };
  const opts = {
    adapter: echoAdapter(),
    driver,
    checks: [],
    mode: 'F' as const,
    repeat: 0,
    target: { adapter: 'echo', variant: 'v1' },
    now: () => new Date('2026-10-13T00:00:00Z'),
  };
  const plain = await runSpec(spec, opts);
  expect(plain).not.toHaveProperty('provenance');
  expect(plain).not.toHaveProperty('provenanceDigest');
  expect(plain.blocks[0]).not.toHaveProperty('provenance');
  const recorded = await runSpec(spec, { ...opts, recordProvenance: true });
  expect(recorded.provenance).toMatchObject({
    driver: { idHash: provenanceHash('scripted'), seedsHash: provenanceHash({ sample: 17 }) },
    adapter: { idHash: provenanceHash('echo'), versionHash: provenanceHash(opts.adapter.version) },
  });
  expect(recorded.blocks[0]?.provenance).toMatchObject({
    specIndex: 0,
    stimulusHash: provenanceHash({ user: 'actual user text' }),
    ledgerHash: provenanceHash({ plan: 'Acme' }),
    artifacts: [],
  });
  const strip = (run: typeof recorded) => {
    const { provenance: _, provenanceDigest: ___, ...rest } = run;
    return { ...rest, blocks: run.blocks.map(({ provenance: __, ...block }) => block) };
  };
  expect(strip(recorded)).toEqual(plain);
});
it('leaves unknown driver seeds explicit', async () => {
  const run = await runSpec(spec, {
    adapter: echoAdapter(),
    driver: { ...createScriptedDriver(), id: 'custom', seeds: undefined },
    checks: [],
    mode: 'T',
    repeat: 0,
    recordProvenance: true,
  });
  expect(run.provenance?.driver.seedsHash).toBeNull();
});

it('hashes only artifacts the checks read and records unreadable paths without inventing a digest', async () => {
  const capture = captureArtifacts({
    observed: { text: '', segments: [], toolCalls: [], latencyMs: 0, cost: {} },
    readArtifact: async (path) => {
      if (path === 'missing.txt') throw new Error('missing');
      return new TextEncoder().encode('Acme');
    },
  });
  expect(capture.artifacts).toEqual([]);
  expect(await capture.readArtifact?.('quote.txt')).toEqual(new TextEncoder().encode('Acme'));
  await expect(capture.readArtifact?.('missing.txt')).rejects.toThrow('missing');
  expect(capture.artifacts).toEqual([
    {
      pathHash: provenanceHash('quote.txt'),
      sha256: '37036cd8f9746d335038eca92f8a73ae5f1bca4779a1e55e5812e37743b2f5bf',
    },
    { pathHash: provenanceHash('missing.txt'), sha256: null },
  ]);
  expect(JSON.stringify(capture.artifacts)).not.toContain('Acme');
});
