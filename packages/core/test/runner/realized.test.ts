import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { completeBaselineProvenance } from '../../src/radius/provenance';
import { provenanceDigest, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import type { Stimulus } from '../../src/schema/spec';
import { echoAdapter, specOf } from './support';

const spec = specOf({ id: 'realized', blocks: [{ user: 'authored' }] });

/** A run of one block whose driver sends `stimulus` in place of the authored `{ user: 'authored' }`. */
function sending(stimulus: Stimulus) {
  return runSpec(spec, {
    adapter: echoAdapter(),
    driver: {
      ...createScriptedDriver(),
      next: (ctx) =>
        ctx.blockIndex > 0 ? { kind: 'stop', reason: 'done' } : { kind: 'block', blockIndex: 0, stimulus },
    },
    checks: [],
    mode: 'F',
    repeat: 0,
    target: { adapter: 'echo', variant: 'v1' },
    recordProvenance: true,
    runId: 'realized',
    now: () => new Date('2026-10-15T00:00:00Z'),
  });
}

describe('the realized text of a block', () => {
  it('is recorded when the text sent differs from the text written', async () => {
    const run = await sending({ user: 'actually sent' });
    expect(run.blocks[0]?.realized).toEqual({ text: 'actually sent' });
  });

  it('is not recorded when only the stimulus kind differs: the same text sent as an injection', async () => {
    const run = await sending({ injection: { class: 'D1_off_topic', user: 'authored' } });
    expect(run.status).toBe('completed');
    expect(run.blocks[0]).not.toHaveProperty('realized');
  });

  it('is covered by the provenance digest, so a changed text no longer passes as the baseline', async () => {
    const run = await sending({ user: 'actually sent' });
    const changed = structuredClone(run);
    if (changed.blocks[0]?.realized) changed.blocks[0].realized.text = 'never sent';
    expect(provenanceDigest(changed)).not.toBe(run.provenanceDigest);
    const provenance = run.provenance;
    if (!provenance) throw new Error('the run recorded no provenance');
    const campaign = {
      version: 2 as const,
      adapters: [
        {
          ...provenance.adapter,
          targetHash: provenanceHash(run.target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    };
    expect(completeBaselineProvenance({ provenance: campaign, runs: [run] })).toBe(true);
    expect(completeBaselineProvenance({ provenance: campaign, runs: [changed] })).toBe(false);
  });

  it('leaves the digest of a run without realized text as it was', async () => {
    const run = await sending({ user: 'authored' });
    expect(run.blocks[0]).not.toHaveProperty('realized');
    const { index, blockId, injected, givenHash, provenance } = run.blocks[0] ?? ({} as never);
    expect(run.provenanceDigest).toBe(
      provenanceHash({ run: run.provenance, blocks: [{ index, blockId, injected, givenHash, provenance }] }),
    );
  });
});
