import { describe, expect, it } from 'vitest';
import { bankItems, SeedData, sameTestKey, vectorOf } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { type BlockRun, type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/** Two blocks are the same test only against the same tool answers (docs/generating.md, repeated ends of walks). */
describe('minimality groups blocks by the tool answers they run against', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const copy = (id: string, change: (spec: typeof cover.spec) => void) => {
    const spec = structuredClone(cover.spec);
    spec.id = id;
    change(spec);
    return { ...cover, spec };
  };
  const twin = copy('twin', () => {});
  const relabelled = copy('relabelled', (spec) => {
    spec.channel = spec.channel === 'web' ? 'messaging' : 'web';
    spec.tags = spec.tags?.map((tag) => (tag.startsWith('persona:') ? 'persona:another' : tag));
  });
  const otherWorld = copy('other-world', (spec) => {
    const answer = spec.given?.world?.tools?.lookup_record;
    if (!answer) throw new Error('the fixture has no lookup answer');
    spec.given = {
      ...spec.given,
      world: { tools: { lookup_record: { result: { ...(answer.result as object), status: 'changed' } } } },
    };
  });
  const classes = FAULT_CLASSES.filter((cls) => cls.id === 'X1.case');
  const options = { faults: (spec: typeof cover.spec) => faultFamily(spec, classes), cheaters: [], k: 1 };
  const suite = async (complete: Generation['complete']) => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    await data.memoized('runs', async () => runAll(mini, options));
    return data;
  };
  const last = (blocks: BlockRun[], id: string): BlockRun =>
    required(blocks.filter((block) => block.spec === id && block.fields.length > 0).at(-1));
  const item = required(bankItems().find((entry) => entry.id === 'minimal.X1.case'));

  it('keeps a copy on another channel and another persona in the same group, and a copy with other tool answers out of it', async () => {
    const runs = await runAll({ ...generated, complete: [cover, twin, relabelled, otherWorld] }, options);
    const base = last(runs.blocks, cover.spec.id);
    expect(sameTestKey(last(runs.blocks, 'twin'))).toBe(sameTestKey(base));
    expect(sameTestKey(last(runs.blocks, 'relabelled'))).toBe(sameTestKey(base));
    const other = last(runs.blocks, 'other-world');
    // The Then and the outcomes are the same: only the answers of the tool tell the two blocks apart.
    expect(vectorOf(other)).toBe(vectorOf(base));
    expect(other.answers).not.toBe(base.answers);
    expect(sameTestKey(other)).not.toBe(sameTestKey(base));
  }, 600_000);

  it('still fails a suite that keeps a true duplicate: the same Then against the same answers', async () => {
    const found = await item.check(await suite([cover, twin]));
    expect(found.pass, found.detail).toBe(false);
    expect(found.detail).toMatch(/[1-9]\d* groups contain a removable duplicate/);
  }, 600_000);
}, 600_000);
