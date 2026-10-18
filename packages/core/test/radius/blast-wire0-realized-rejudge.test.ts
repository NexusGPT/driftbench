import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { prepareRejudge } from '../../src/radius/rejudge';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from '../runner/support';

/**
 * Blast radius of PR 430 (merged) on rejudge: a rejudge reads each block against the text the spec wrote.
 * A run whose driver sent other text (it carries `realized`) must be refused, even when its driver has the
 * scripted driver's id and no seeds, or the judge would read the reply against a message never sent.
 */
const original = specOf({
  id: 'acme-quote',
  metadata: { depends: { stages: ['offer'] } },
  criteria: [{ name: 'price', rubric: 'A price is present.', gating: true }],
  blocks: [{ when: { user: 'Quote Acme.' }, expect: { criteria: ['price'] } }, { when: { user: 'Thanks.' } }],
});
const changed = () => ({
  ...original,
  criteria: original.criteria?.map((c) => ({ ...c, rubric: 'The price must be 12.' })),
});
const target = { adapter: 'echo', variant: 'v1' };
const options = {
  baselineProvenance: {
    version: 2 as const,
    adapters: [
      {
        ...adapterProvenance(echoAdapter(), target.adapter),
        targetHash: provenanceHash(target),
        agentVersionHash: provenanceHash('v1'),
      },
    ],
  },
  fromCampaign: 'acme-base',
  agentVersion: 'v1',
  criteria: ['price'],
  now: new Date('2026-10-13T01:00:00Z'),
};

/** A run whose driver is the scripted one, by id and seeds, but sends `sent` in block 0. */
function runSending(sent: string | undefined, recordRealizedText = false) {
  return runSpec(original, {
    adapter: echoAdapter(),
    driver: {
      ...createScriptedDriver(),
      next: (ctx) =>
        ctx.blockIndex > 1
          ? { kind: 'stop', reason: 'done' }
          : {
              kind: 'block',
              blockIndex: ctx.blockIndex,
              stimulus:
                ctx.blockIndex === 0 && sent !== undefined
                  ? { user: sent }
                  : (original.blocks[ctx.blockIndex]?.when as never),
            },
    },
    checks: [],
    mode: 'F',
    repeat: 0,
    target,
    recordProvenance: true,
    ...(recordRealizedText ? { recordRealizedText: true } : {}),
    now: () => new Date('2026-10-13T00:00:00Z'),
  });
}

describe('PR 430 blast radius: rejudge and a block realized text', () => {
  it('prepares a rejudge of a run that sent what the spec wrote', async () => {
    const run = await runSending(undefined);
    expect(run.blocks.some((block) => 'realized' in block)).toBe(false);
    expect(prepareRejudge(original, changed(), run, options).contexts).toHaveLength(2);
  });

  it.each([false, true])('refuses a run whose driver sent other text (text kept: %s)', async (kept) => {
    const run = await runSending('Quote Acme, in euros.', kept);
    expect(run.blocks[0]?.realized?.hash).toBe(provenanceHash('Quote Acme, in euros.'));
    expect(run.provenance?.driver.idHash).toBe(provenanceHash('scripted'));
    expect(() => prepareRejudge(original, changed(), run, options)).toThrow(/stimulus does not match/);
  });
});
