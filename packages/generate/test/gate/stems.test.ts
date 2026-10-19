import { type LoadResult, resolveSpecParents, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { gateFiles } from '../../src/gate';
import { candidate, gate, makeSpec, OPTIONS, orderBlock } from './support';

/**
 * The gate on a suite with stems (fictional shop data): an opening a child replays from its stem is gated once,
 * in the stem; a stem and the specs that start from it fall in one split; and the gated files are written as
 * authored, so the gated folder loads again.
 */

const STAGES = ['start', 'ordered'];

/** A stem with one opening block and two children that order from it, as `generate` writes them. */
function tree(n: number): Spec[] {
  const stem = makeSpec({
    id: `stem-${n}`,
    stages: STAGES,
    blocks: [{ id: 'hello', when: { user: `Hello, shop ${n}` }, expect: { must: ['What would you like'] } }],
  });
  const red = makeSpec({
    id: `red-${n}`,
    stages: STAGES,
    blocks: [{ ...orderBlock('red'), parent: `stem-${n}#hello` }],
  });
  const blue = makeSpec({
    id: `blue-${n}`,
    stages: STAGES,
    blocks: [
      {
        id: 'blue',
        parent: `stem-${n}#hello`,
        when: { user: 'Please order the blue one.' },
        expect: { stage: 'ordered', tools: [{ label: 'order.create', count: 1, input: { sku: 'sku-9' } }] },
      },
    ],
  });
  return [stem, red, blue];
}

/** The specs written back out, as `loadSpecs` hands them to the gate. */
function writtenOut(specs: readonly Spec[]): Spec[] {
  return resolveSpecParents(
    specs.map((spec) => validateSpec(spec, `${spec.id}.yaml`)),
    validateSpec,
  ).map((result: LoadResult) => {
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.spec;
  });
}

describe('the gate on a suite with stems', () => {
  it('gates a shared opening once, in its stem: a child holds records for its own blocks only', async () => {
    const result = await gate(writtenOut(tree(1)));
    expect(result.blocks.map((record) => `${record.spec}#${record.id}@${record.index}`)).toEqual([
      'stem-1#hello@0',
      'red-1#red@1',
      'blue-1#blue@1',
    ]);
  });

  it('draws a stem and the specs that start from it into one split', async () => {
    const specs = writtenOut(Array.from({ length: 12 }, (_, n) => tree(n)).flat());
    const result = await gate(specs, { options: { holdoutShare: 0.5 } });
    const splitOf = new Map<string, Set<string>>();
    for (const record of result.blocks) {
      if (record.split === undefined) continue;
      const root = record.spec.replace(/^(red|blue)-/, 'stem-');
      splitOf.set(root, (splitOf.get(root) ?? new Set()).add(record.split));
    }
    expect(splitOf.size).toBeGreaterThan(0);
    for (const [root, splits] of splitOf) expect([...splits], root).toHaveLength(1);
    // Both splits are drawn over the trees.
    expect(new Set([...splitOf.values()].flatMap((splits) => [...splits]))).toEqual(
      new Set(['dev', 'holdout']),
    );
  });

  it('writes the gated specs as authored, so the gated folder loads again, the stems with them', async () => {
    const specs = writtenOut(tree(1));
    const result = await gate(specs, { options: { holdoutShare: 0 } });
    const files = gateFiles(
      result,
      specs.map((spec) => candidate(spec)),
      { source: 'candidates', references: ['function:shop'], options: OPTIONS },
    );
    const read = (path: string) => {
      const text = files.find((file) => file.path === path)?.text;
      if (text === undefined) throw new Error(`no ${path} in ${files.map((file) => file.path).join(', ')}`);
      return parse(text) as Spec;
    };
    const red = read('specs/red-1.yaml');
    expect(red.blocks.map((block) => [block.id, block.parent])).toEqual([['red', 'stem-1#hello']]);
    expect(red.metadata?.parent).toBeUndefined();
    expect(
      (red.metadata?.gate as { blocks: Array<{ block: string }> } | undefined)?.blocks.map(
        (entry) => entry.block,
      ),
    ).toEqual(['red']);
    const stem = read('specs/stem-1.yaml');
    const again = writtenOut([stem, red, read('specs/blue-1.yaml')]);
    expect(again.find((spec) => spec.id === 'red-1')?.blocks.map((block) => block.id)).toEqual([
      'stem-1#hello',
      'red',
    ]);
  });

  it('writes a child whole when its stem is not gated with it, so the gated file runs on its own', async () => {
    // As `gate generated/specs/graph` sees it: the loader read the stem from specs/stems/ to write the child
    // out, but only the seeder folder is gated.
    const [, red] = writtenOut(tree(3));
    const result = await gate([red as Spec], { options: { holdoutShare: 0 } });
    const files = gateFiles(result, [candidate(red as Spec)], {
      source: 'candidates',
      references: ['function:shop'],
      options: OPTIONS,
    });
    const text = files.find((file) => file.path === 'specs/red-3.yaml')?.text ?? '';
    const written = parse(text) as Spec;
    expect(written.blocks.map((block) => [block.id, block.parent])).toEqual([
      ['stem-3#hello', undefined],
      ['red', undefined],
    ]);
    // The opening is kept as it was, Then included: it is replayed, never gated as the child's own block.
    expect(written.blocks[0]?.expect).toEqual({ must: ['What would you like'] });
    expect(written.metadata?.parent).toEqual({ from: 'stem-3#hello', replayed: 1 });
    const alone = validateSpec(written, 'red-3.yaml');
    expect(alone.ok ? [] : alone.errors).toEqual([]);
  });

  it('writes a stem whose own blocks were all rejected when a child of it is written', async () => {
    const [stem, red] = tree(2) as [Spec, Spec, Spec];
    // The opening's Then is words the user already says: the observed stage rejects its only block, while the
    // child's replay of it still passes on the shop agent.
    const failing = makeSpec({
      ...stem,
      blocks: [
        {
          id: 'hello',
          when: { user: 'Hello, what would you like to order today, shop 2?' },
          expect: { must: ['would you like to order today'] },
        },
      ],
    });
    const specs = writtenOut([failing, red]);
    const result = await gate(specs, { options: { holdoutShare: 0 } });
    expect(result.blocks.find((record) => record.spec === 'stem-2')).toMatchObject({
      status: 'rejected',
      rejectedAt: 'observed',
    });
    expect(result.blocks.find((record) => record.spec === 'red-2')?.status).toBe('accepted');
    const files = gateFiles(
      result,
      specs.map((spec) => candidate(spec)),
      { source: 'candidates', references: ['function:shop'], options: OPTIONS },
    );
    const written = files.map((file) => file.path);
    expect(written).toContain('specs/red-2.yaml');
    expect(written).toContain('specs/stem-2.yaml');
  });
});
