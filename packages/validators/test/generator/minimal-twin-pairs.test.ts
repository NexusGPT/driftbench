import { describe, expect, it } from 'vitest';
import { bankItems, SeedData, unprotectedMembers } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import type { HiddenSpec } from '../../src/ladders/generator/hidden';
import { type BlockRun, type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * A block is removable only if removing it loses no declared obligation: an injected deviation class, a declared
 * perturbation, a twin pair on a declared axis, membership in a declared metamorphic family. Each obligation is held
 * once per path over the whole suite; a second holder is a repeat, and a block on an undeclared axis holds none
 * (docs/validators.md, section 3, Same test).
 */
describe('minimality protects the first holder of each declared obligation, once per path', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const channels = generated.hidden.channels.filter((entry) => entry !== cover.spec.channel);
  const personas = generated.hidden.personas.filter(
    (entry) => !cover.spec.tags?.includes(`persona:${entry.id}`),
  );
  const copyOf = (
    source: Generation['complete'][number],
    id: string,
    change?: (spec: typeof cover.spec) => void,
  ) => {
    const spec = structuredClone(source.spec);
    spec.id = id;
    change?.(spec);
    return { ...source, spec };
  };
  const copy = (id: string, channel: string, persona?: string) =>
    copyOf(cover, id, (spec) => {
      spec.channel = channel;
      if (persona !== undefined)
        spec.tags = spec.tags?.map((tag) => (tag.startsWith('persona:') ? `persona:${persona}` : tag));
    });
  const classes = FAULT_CLASSES.filter((cls) => cls.id === 'X1.case');
  const options = { faults: (hidden: HiddenSpec) => faultFamily(hidden, classes), cheaters: [], k: 1 };
  type Pick = 'last' | 'injected' | 'perturbed';
  // The members of each group (spec ids) that hold no obligation, evaluated against one suite.
  const unprotectedOf = async (
    complete: Generation['complete'],
    groups: string[][],
    pick: Pick = 'last',
  ): Promise<string[][]> => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    const runs = await runAll(mini, options);
    await data.memoized('runs', async () => runs);
    const blockOf = (id: string): BlockRun => {
      const own = runs.blocks.filter((block) => block.spec === id && block.fields.length > 0);
      return required(
        pick === 'last'
          ? own.at(-1)
          : own.find((block) => (pick === 'injected' ? block.injected : block.perturbed !== '')),
      );
    };
    const result: string[][] = [];
    for (const ids of groups)
      result.push((await unprotectedMembers(data, ids.map(blockOf))).map((block) => block.spec));
    return result;
  };

  it('has the declared channels and personas it needs', () => {
    expect(channels.length).toBeGreaterThan(0);
    expect(personas.length).toBeGreaterThan(0);
  });

  it('protects a written walk and its twin on another declared channel', async () => {
    const [group] = await unprotectedOf(
      [cover, copy('twin-channel', required(channels[0]))],
      [[cover.spec.id, 'twin-channel']],
    );
    expect(group).toEqual([]);
  }, 600_000);

  it('protects one twin per declared axis: a channel twin and a persona twin', async () => {
    const [group] = await unprotectedOf(
      [
        cover,
        copy('twin-channel', required(channels[0])),
        copy('twin-persona', cover.spec.channel as string, required(personas[0]).id),
      ],
      [[cover.spec.id, 'twin-channel', 'twin-persona']],
    );
    expect(group).toEqual([]);
  }, 600_000);

  it('counts a second pair on the same axis, an undeclared copy and a same-context copy as repeats', async () => {
    const [group] = await unprotectedOf(
      [
        cover,
        copy('twin-channel', required(channels[0])),
        copy('twin-channel-again', required(channels[0])),
        copy('twin-undeclared', 'a-channel-nobody-declared'),
        copy('twin-same', cover.spec.channel as string),
      ],
      [[cover.spec.id, 'twin-channel', 'twin-channel-again', 'twin-undeclared', 'twin-same']],
    );
    expect(group).toEqual(['twin-channel-again', 'twin-undeclared', 'twin-same']);
  }, 600_000);

  it('holds one twin pair per path over the whole suite, not one per group', async () => {
    const otherWalk = copy('other-walk', cover.spec.channel as string);
    const answer = otherWalk.spec.given?.world?.tools?.lookup_record;
    if (!answer) throw new Error('the fixture has no lookup answer');
    otherWalk.spec.given = {
      ...otherWalk.spec.given,
      world: { tools: { lookup_record: { result: { ...(answer.result as object), status: 'changed' } } } },
    };
    const otherTwin = structuredClone(otherWalk);
    otherTwin.spec.id = 'other-twin';
    otherTwin.spec.channel = required(channels[0]);
    const [one, two] = await unprotectedOf(
      [cover, copy('twin', required(channels[0])), otherWalk, otherTwin],
      [
        [cover.spec.id, 'twin'],
        ['other-walk', 'other-twin'],
      ],
    );
    // The first walk keeps the channel pair of the path; a second walk of the same path holds no obligation.
    expect(one).toEqual([]);
    expect(two).toEqual(['other-walk', 'other-twin']);
  }, 600_000);

  it('never protects a copy on an undeclared channel, whatever else differs', async () => {
    const odd = copy('odd', 'a-channel-nobody-declared', required(personas[0]).id);
    const witness = copy('witness', cover.spec.channel as string, required(personas[0]).id);
    const [group] = await unprotectedOf([cover, witness, odd], [[cover.spec.id, 'witness', 'odd']]);
    // The persona twin is protected; the copy on the undeclared channel is a repeat although its persona differs.
    expect(group).toEqual(['odd']);
  }, 600_000);

  it('protects the first injection of a class on a path and counts a second one as a repeat', async () => {
    const source = required(
      generated.complete.find(({ spec }) => spec.blocks.some((block) => 'injection' in (block.when ?? {}))),
    );
    const [one, two] = await unprotectedOf(
      [copyOf(source, 'inject-1'), copyOf(source, 'inject-2')],
      [['inject-1', 'inject-2'], ['inject-1']],
      'injected',
    );
    expect(one).toEqual(['inject-2']);
    // The sole holder of the obligation is never flagged.
    expect(two).toEqual([]);
  }, 600_000);

  it('protects the first spec that carries a declared perturbation on a path and counts a second as a repeat', async () => {
    const source = required(generated.complete.find(({ spec }) => (spec.perturbations ?? []).length > 0));
    const [one] = await unprotectedOf(
      [copyOf(source, 'perturbed-1'), copyOf(source, 'perturbed-2')],
      [['perturbed-1', 'perturbed-2']],
      'perturbed',
    );
    expect(one).toEqual(['perturbed-2']);
  }, 600_000);

  it('protects the first metamorphic family of a walk on a path and counts a second family as a repeat', async () => {
    const source = required(
      generated.complete.find(
        ({ spec }) => (spec.metadata?.generated as { metamorphic?: unknown } | undefined)?.metamorphic,
      ),
    );
    type Meta = { metamorphic: { family: string; variant: number; of: number } };
    const family = (id: string, name: string, variant: number, text: string, of = 2) =>
      copyOf(source, id, (spec) => {
        const meta = required(spec.metadata?.generated) as Meta;
        meta.metamorphic.family = name;
        meta.metamorphic.variant = variant;
        meta.metamorphic.of = of;
        const first = required(spec.blocks[0]);
        first.when = { user: text };
      });
    const [group] = await unprotectedOf(
      [
        family('fam-a-1', 'A', 1, 'first wording'),
        family('fam-a-2', 'A', 2, 'second wording'),
        family('fam-b-1', 'B', 1, 'first wording'),
        family('fam-a-1-clone', 'A', 1, 'first wording'),
        // The plants of the reviewer: a byte-for-byte clone relabelled out of range, and a relabel inside it.
        family('fam-a-1-relabel-3', 'A', 3, 'first wording'),
        family('fam-a-1-relabel-2', 'A', 2, 'first wording'),
        family('fam-a-3-new-words', 'A', 3, 'third wording'),
      ],
      [
        [
          'fam-a-1',
          'fam-a-2',
          'fam-b-1',
          'fam-a-1-clone',
          'fam-a-1-relabel-3',
          'fam-a-1-relabel-2',
          'fam-a-3-new-words',
        ],
      ],
    );
    // Each wording of a walk is held once per path, and only by a variant in range: the second family, the clones
    // whatever number they claim, and a variant outside 1..of are repeats.
    expect(group).toEqual([
      'fam-b-1',
      'fam-a-1-clone',
      'fam-a-1-relabel-3',
      'fam-a-1-relabel-2',
      'fam-a-3-new-words',
    ]);
  }, 600_000);

  it('reads an injection from its content, whatever deviation its metadata names', async () => {
    const source = required(
      generated.complete.find(({ spec }) => spec.blocks.some((block) => 'injection' in (block.when ?? {}))),
    );
    const relabelled = copyOf(source, 'inject-relabelled', (spec) => {
      const meta = required(spec.metadata?.generated) as { blocks?: Array<{ cell?: Record<string, string> }> };
      const blocks = meta.blocks;
      for (const entry of blocks ?? []) if (entry.cell) entry.cell.deviation = 'D0_relabelled';
    });
    const [group] = await unprotectedOf(
      [copyOf(source, 'inject-1'), relabelled],
      [['inject-1', 'inject-relabelled']],
      'injected',
    );
    expect(group).toEqual(['inject-relabelled']);
  }, 600_000);

  it('still fails a suite that keeps a second pair on the same axis (item level)', async () => {
    const mini: Generation = {
      ...generated,
      complete: [
        cover,
        copy('twin-channel', required(channels[0])),
        copy('twin-channel-again', required(channels[0])),
      ],
    };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    await data.memoized('runs', async () => runAll(mini, options));
    const item = required(bankItems().find((entry) => entry.id === 'minimal.X1.case'));
    const found = await item.check(data);
    expect(found.detail).toMatch(/[1-9]\d* groups contain a removable duplicate/);
  }, 600_000);
}, 600_000);
