import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

// The product's list of registered custom checks with `permission` taken out. The item must not follow it:
// docs/estate.md section 5 says code checks `permission`, so a judged criterion on it stays wrong.
vi.mock('@agent-nexus/driftbench-generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-nexus/driftbench-generate')>();
  return {
    ...actual,
    REPLAY_CUSTOM_CHECKS: actual.REPLAY_CUSTOM_CHECKS.filter((name: string) => name !== 'permission'),
  };
});
vi.mock('../../src/ladders/estate/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/pipeline')>();
  return { ...actual, estateRun: vi.fn(actual.estateRun) };
});

const ID = 'gen.asks.judged-only-registers';
type Spec = pipeline.EstateRun['specs'][number];
type Body = {
  criteria?: { name: string; gating?: boolean; rubric?: string }[];
  tags?: string[];
  metadata?: { estate?: { judged?: string[] } };
};

describe(`${ID} holds the list of section 5, not the product's`, { timeout: 300_000 }, () => {
  afterEach(() => vi.mocked(pipeline.estateRun).mockReset());

  it('fails a judged criterion on tool.settings.allow-read when the product no longer lists permission', async () => {
    const actual = await vi.importActual<typeof pipeline>('../../src/ladders/estate/pipeline');
    vi.mocked(pipeline.estateRun).mockImplementation(async (seed, profile) => {
      const run = await actual.estateRun(seed, profile);
      const atom = run.scanned.map.atoms.find((candidate) => candidate.id === 'tool.settings.allow-read');
      if (!atom) throw new Error('no tool.settings.allow-read on the seed');
      const specs = [...run.specs];
      const index = specs.findIndex(
        (spec) => spec.loaded && ((spec.loaded.spec as Body).criteria ?? []).length > 0,
      );
      const spec = specs[index] as Spec;
      const body = structuredClone(spec.loaded?.spec) as Body;
      body.criteria = [...(body.criteria ?? []), { name: atom.id, gating: true, rubric: 'planted' }];
      body.tags = [...new Set([...(body.tags ?? []), 'judged'])];
      body.metadata = {
        ...body.metadata,
        estate: { ...body.metadata?.estate, judged: [...(body.metadata?.estate?.judged ?? []), atom.id] },
      };
      specs[index] = { ...spec, loaded: { ...spec.loaded, spec: body } } as Spec;
      return { ...run, specs };
    });
    expect((await genAsksFamily().evaluate(1)).get(ID)).toMatchObject({ pass: false });
  });
});
