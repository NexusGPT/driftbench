import { describe, expect, it } from 'vitest';
import { bankItems, SeedData, unprotectedMembers } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import type { HiddenSpec } from '../../src/ladders/generator/hidden';
import { type BlockRun, type Generation, runAll, wordsOf } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * A block is removable only if removing it loses no declared obligation: an injected deviation class, a declared
 * perturbation, a twin pair on a declared axis, membership in a declared metamorphic family. A holder is protected only
 * when removing it would leave the obligation with no holder: where two specs carry the same obligation each is a repeat
 * of the other, whichever the suite lists first, and a block on an undeclared axis holds none (docs/validators.md,
 * section 3, Same test).
 */
describe('minimality protects the sole holder of each declared obligation', async () => {
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
    // Two specs on one channel are repeats of each other, so neither the written walk nor its twin is protected.
    expect(group).toEqual([
      cover.spec.id,
      'twin-channel',
      'twin-channel-again',
      'twin-undeclared',
      'twin-same',
    ]);
  }, 600_000);

  it('gives the same unprotected members whatever order the suite lists its specs in', async () => {
    const suite = [
      cover,
      copy('twin-channel', required(channels[0])),
      copy('twin-channel-again', required(channels[0])),
      copy('twin-undeclared', 'a-channel-nobody-declared'),
    ];
    const ids = suite.map(({ spec }) => spec.id);
    const [forward] = await unprotectedOf(suite, [ids]);
    const [backward] = await unprotectedOf([...suite].reverse(), [[...ids].reverse()]);
    expect([...(backward ?? [])].sort()).toEqual([...(forward ?? [])].sort());
    expect(forward).toContain('twin-channel-again');
    expect(forward).toContain('twin-channel');
  }, 600_000);

  it('protects the later-listed member of a pair when the earlier one is a repeat of another', async () => {
    // The channel pair is cover + twin-channel; the third spec repeats the twin. Listed last or first, the repeats are
    // the same two specs: the written walk is still the only spec on its channel and stays protected.
    for (const order of [
      ['twin-channel', 'twin-channel-again'],
      ['twin-channel-again', 'twin-channel'],
    ] as const) {
      const [group] = await unprotectedOf(
        [cover, ...order.map((id) => copy(id, required(channels[0])))],
        [[cover.spec.id, ...order]],
      );
      expect([...(group ?? [])].sort()).toEqual(['twin-channel', 'twin-channel-again']);
    }
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
    // Two walks of the path each carry the channel pair, so each pair is a repeat of the other.
    expect(one).toEqual([cover.spec.id, 'twin']);
    expect(two).toEqual(['other-walk', 'other-twin']);
  }, 600_000);

  it('never protects a copy on an undeclared channel, whatever else differs', async () => {
    const odd = copy('odd', 'a-channel-nobody-declared', required(personas[0]).id);
    const witness = copy('witness', cover.spec.channel as string, required(personas[0]).id);
    const [group] = await unprotectedOf([cover, witness, odd], [[cover.spec.id, 'witness', 'odd']]);
    // The persona twin is protected; the copy on the undeclared channel is a repeat although its persona differs.
    expect(group).toEqual(['odd']);
  }, 600_000);

  it('protects the sole injection of a class on a path and counts two as repeats of each other', async () => {
    const source = required(
      generated.complete.find(({ spec }) => spec.blocks.some((block) => 'injection' in (block.when ?? {}))),
    );
    const [one, two] = await unprotectedOf(
      [copyOf(source, 'inject-1'), copyOf(source, 'inject-2')],
      [['inject-1', 'inject-2'], ['inject-1']],
      'injected',
    );
    expect(one).toEqual(['inject-1', 'inject-2']);
    expect(two).toEqual(['inject-1']);
    // The sole holder of the obligation is never flagged, listed first or last.
    const [sole] = await unprotectedOf([copyOf(source, 'inject-1')], [['inject-1']], 'injected');
    expect(sole).toEqual([]);
    const [reversed] = await unprotectedOf(
      [copyOf(source, 'inject-2'), copyOf(source, 'inject-1')],
      [['inject-2', 'inject-1']],
      'injected',
    );
    expect(reversed).toEqual(['inject-2', 'inject-1']);
  }, 600_000);

  it('protects the sole spec that carries a declared perturbation on a path and counts two as repeats', async () => {
    const source = required(generated.complete.find(({ spec }) => (spec.perturbations ?? []).length > 0));
    const [one] = await unprotectedOf(
      [copyOf(source, 'perturbed-1'), copyOf(source, 'perturbed-2')],
      [['perturbed-1', 'perturbed-2']],
      'perturbed',
    );
    expect(one).toEqual(['perturbed-1', 'perturbed-2']);
    const [sole] = await unprotectedOf([copyOf(source, 'perturbed-1')], [['perturbed-1']], 'perturbed');
    expect(sole).toEqual([]);
  }, 600_000);

  it('protects the sole holder of each wording of a walk and counts every holder of a shared wording', async () => {
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
    // A wording said by one spec is protected: the second wording of family A. A wording several specs say is carried
    // by all of them, so each is a repeat; a variant outside 1..of holds no wording and is a repeat as well.
    expect(group).toEqual([
      'fam-a-1',
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
      const meta = required(spec.metadata?.generated) as {
        blocks?: Array<{ cell?: Record<string, string> }>;
      };
      const blocks = meta.blocks;
      for (const entry of blocks ?? []) if (entry.cell) entry.cell.deviation = 'D0_relabelled';
    });
    const [group] = await unprotectedOf(
      [copyOf(source, 'inject-1'), relabelled],
      [['inject-1', 'inject-relabelled']],
      'injected',
    );
    expect(group).toEqual(['inject-1', 'inject-relabelled']);
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

  it('never reads a no-op edit of a holder as new words (a property over seeded edits)', () => {
    const source = required(
      generated.complete.find(
        ({ spec }) => (spec.metadata?.generated as { metamorphic?: unknown } | undefined)?.metamorphic,
      ),
    );
    const base = wordsOf(source.spec);
    let seed = 12345;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const reorder = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    for (let trial = 0; trial < 60; trial += 1) {
      const spec = structuredClone(source.spec);
      for (let edit = 0; edit < 1 + next(4); edit += 1) {
        const block = required(spec.blocks[next(spec.blocks.length)]);
        const kind = next(4);
        if (kind === 0 && block.given === undefined) block.given = {};
        else if (kind === 1 && block.when) block.when = reorder(block.when);
        else if (kind === 2 && block.when && 'user' in block.when)
          block.when = { user: `  ${block.when.user.replace(/ /g, '   ')} \n` };
        else if (kind === 3 && block.given) block.given = reorder(block.given);
      }
      expect(wordsOf(spec), `trial ${trial}`).toBe(base);
    }
    // The history a block starts from is part of the words: two prefixes are two tests, and padding is not.
    const withPrefix = (text: string) => {
      const spec = structuredClone(source.spec);
      required(spec.blocks[1]).given = { prefix: [{ role: 'user', content: text }] };
      return spec;
    };
    expect(wordsOf(withPrefix('hello there'))).not.toBe(base);
    expect(wordsOf(withPrefix('hello there'))).not.toBe(wordsOf(withPrefix('goodbye')));
    expect(wordsOf(withPrefix('  hello   there '))).toBe(wordsOf(withPrefix('hello there')));
    // A real edit of the words is still other words.
    const changed = structuredClone(source.spec);
    const first = required(changed.blocks[0]);
    first.when = { user: `${first.when && 'user' in first.when ? first.when.user : ''} and more` };
    expect(wordsOf(changed)).not.toBe(base);
  });
}, 600_000);
