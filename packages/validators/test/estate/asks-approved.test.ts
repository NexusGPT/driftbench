import { describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

type Loaded = {
  tags?: string[];
  blocks: Array<{ when?: { user?: string } }>;
  metadata?: { estate?: Record<string, unknown> };
};

/** The run of a seed with the first complete spec of a test type changed by `edit`. */
async function changed(testType: string, edit: (spec: Loaded) => void): Promise<pipeline.EstateRun> {
  const run = await pipeline.estateRun(1);
  const specs = structuredClone(run.specs);
  const target = specs.find(
    (spec) =>
      spec.record.complete &&
      spec.record.testType === testType &&
      (spec.loaded?.spec.metadata?.estate as { ask?: string } | undefined)?.ask === 'bank',
  );
  if (!target?.loaded) throw new Error(`no complete ${testType} spec asked with a bank phrase`);
  edit(target.loaded.spec as unknown as Loaded);
  return { ...run, specs };
}

async function verdict(run: pipeline.EstateRun) {
  const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
  try {
    return (await genAsksFamily().evaluate(1)).get('gen.asks.asks-approved');
  } finally {
    mock.mockRestore();
  }
}

describe('gen.asks.asks-approved', { timeout: 300_000 }, () => {
  it('holds on the generated estate: approved phrases, and code-written asks that say so', async () => {
    expect(await verdict(await pipeline.estateRun(1))).toEqual({ pass: true, detail: 'holds' });
  });

  it('fails a complete spec that asks a phrase nobody approved and does not say it wrote the ask', async () => {
    const run = await changed('route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = 'Kindly sort out the pending supplier matters.';
    });
    expect(await verdict(run)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('1 complete specs ask an unapproved phrase'),
    });
  });

  it('fails a code-written ask that names no source of its words', async () => {
    const run = await changed('route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = 'Kindly sort out the pending supplier matters.';
      spec.tags = [...(spec.tags ?? []), 'ask:code'];
      if (spec.metadata?.estate) spec.metadata.estate.ask = 'code';
    });
    expect((await verdict(run))?.pass).toBe(false);
  });

  it('fails a code-written ask where the bank holds an approved phrase, since an approved phrase always wins', async () => {
    const run = await changed('route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = 'Kindly sort out the pending supplier matters.';
      spec.tags = [...(spec.tags ?? []), 'ask:code'];
      if (spec.metadata?.estate)
        Object.assign(spec.metadata.estate, { ask: 'code', askFrom: 'a description' });
    });
    expect((await verdict(run))?.pass).toBe(false);
  });

  it('accepts the same code-written ask where the row has no situation to take an approved phrase from', async () => {
    const run = await changed('route_positive', (spec) => {
      if (spec.blocks[0]?.when) spec.blocks[0].when.user = 'Kindly sort out the pending supplier matters.';
      spec.tags = [...(spec.tags ?? []), 'ask:code'];
      if (spec.metadata?.estate)
        Object.assign(spec.metadata.estate, { ask: 'code', askFrom: 'a description', situation: null });
    });
    expect((await verdict(run))?.pass).toBe(true);
  });
});
