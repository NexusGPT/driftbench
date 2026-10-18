import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { removable, removeBlock, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, type GeneratorParts, generateFrom } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

/**
 * The minimality reduction keeps a reduced spec valid when its blocks carry links (`metadata.links`):
 * the links of the removed block go with it. Fictional data only.
 */

const link = (block: string | number | undefined, section: string) => ({
  ...(block !== undefined ? { block } : {}),
  to: { kind: 'prompt_section', prompt: 'zed', section },
  status: 'declared',
});

const spec = {
  id: 'zed-links',
  kind: 'conversation',
  blocks: [
    { id: 'b1', when: { user: 'Hello' }, expect: { must: ['hi'] } },
    { id: 'b2', when: { user: 'My card is gone.' }, expect: { must: ['card'] } },
    { id: 'b3', when: { user: 'Thanks.' }, expect: { must: ['bye'] } },
  ],
  metadata: {
    links: [
      link('b1', 'cards'),
      link('b2', 'cards'),
      link(2, 'cards'),
      link(1, 'staff'),
      link(undefined, 'chat'),
    ],
  },
} as unknown as Spec;

describe('removeBlock with block links', () => {
  it('drops the links of the removed block, moves later index links down one, keeps links of every block', () => {
    const reduced = removeBlock(spec, 1);
    expect(reduced.blocks.map((block) => block.id)).toEqual(['b1', 'b3']);
    expect(reduced.metadata?.links).toEqual([link('b1', 'cards'), link(1, 'cards'), link(undefined, 'chat')]);
    expect(validateSpec(reduced).ok).toBe(true);
    // The input spec is not changed.
    expect((spec.metadata?.links as unknown[]).length).toBe(5);
  });
});

const parts: GeneratorParts = {
  faults: (hidden) =>
    faultFamily(
      hidden,
      FAULT_CLASSES.filter((cls) => cls.id === 'X3.stay'),
    ).filter((fault) => fault.where === 'any' && fault.rate === 1),
  cheaters: ['constant', 'echo'],
  k: 1,
  baseline: () => [],
};

describe('minimality on a generation whose blocks carry links', () => {
  it('a true duplicate stays removable when every block links a prompt section', async () => {
    const hidden = hiddenSpec(1);
    const generated: Generation = structuredClone(
      await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true }),
    );
    for (const { spec: each } of generated.complete) {
      each.metadata = {
        ...(each.metadata ?? {}),
        links: each.blocks.map((block, index) => link(block.id ?? index, each.id)),
      };
    }
    const source = generated.complete.find(({ spec: each }) => each.id === 'gen-phrase-002');
    if (!source) throw new Error('no gen-phrase-002');
    const copy = structuredClone(source);
    copy.spec.id = 'approved-phrase-duplicate';
    generated.complete.push(copy);
    generated.loaded.push(copy);
    const data = new SeedData(generated.hidden.seed, parts, async () => ({}) as never);
    await data.memoized('generated', async () => generated);
    const block = (await data.runs()).blocks.find((entry) => entry.key === 'gen-phrase-002#b3-value');
    if (!block) throw new Error('no candidate block');
    expect(await removable(data, block)).toBe(true);
  }, 300_000);
});
