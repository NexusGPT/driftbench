import { describe, expect, it } from 'vitest';
import type { PathRelation } from '../../src/extract/proposal';
import type { SpecDraft } from '../../src/seed/assemble';
import { renderDraft } from '../../src/seed/assemble';
import { TerminalSubsumption } from '../../src/seed/minimal';
import { type SeedContext, scenarioDraft } from '../../src/seed/seed-drafts';
import { desk, fixture, split, twoChannels, twoPersonas } from './desk';

const run = { seed: 1031, mapPath: '../desk.yaml' };

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

function walk(
  prepared: ReturnType<typeof fixture>,
  id: string,
  path: PathRelation,
  seeder: SpecDraft['seeder'] = 'twise',
  cell: Array<[number, number]> = [],
) {
  const context: SeedContext = { seed: 1031, t: 2, max: 100 };
  const built = scenarioDraft(prepared, context, id, seeder, id, cell, { preferred: [path], others: [] });
  if (!('draft' in built)) throw new Error(`${id} did not build`);
  if (cell.length > 0) built.draft.perturbations = undefined;
  return built.draft;
}

// The same walk with another Then on its first block: not a twin of any other walk, same end.
const reworded = (draft: ReturnType<typeof walk>) => {
  const first = draft.blocks[0];
  if (!first) throw new Error('the walk has no block');
  first.must_not = [...(first.must_not ?? []), 'a parcel opening'];
  return draft;
};

// The same walk with another Then on its last block: it ends on a block no other walk ends on.
const endsElsewhere = (draft: ReturnType<typeof walk>) => {
  const last = draft.blocks.at(-1);
  if (!last) throw new Error('the walk has no block');
  last.must_not = [...(last.must_not ?? []), 'a parcel closing'];
  return draft;
};

// The same walk with its last message worded as another block of the suite words its own: the same test, said
// in words the suite already says.
const lastWordedAs = (draft: ReturnType<typeof walk>, text: string) => {
  const last = draft.blocks.at(-1);
  if (last?.stimulus.kind !== 'phrase') throw new Error('the last block says no phrase');
  last.stimulus = { ...last.stimulus, phrase: { ...last.stimulus.phrase, text } };
  return draft;
};

const textOf = (draft: ReturnType<typeof walk>, index: number) => {
  const stimulus = draft.blocks[index]?.stimulus;
  if (stimulus?.kind !== 'phrase') throw new Error('the block says no phrase');
  return stimulus.phrase.text;
};

describe('terminal subsumption', () => {
  it('drops the repeated end of a walk another written walk already says, and keeps the first walk whole', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks.length).toBeLessThan(length);
    expect(second.blocks.length).toBeGreaterThan(0);
    const reduction = (
      renderDraft(prepared, second, run).spec.metadata as {
        generated: { reduced_ends: unknown };
      }
    ).generated.reduced_ends;
    expect(reduction).toEqual({
      from_blocks: length,
      to_blocks: second.blocks.length,
      duplicates: first.blocks.slice(second.blocks.length).map((block) => ({
        block: block.id,
        duplicate_of: { spec: 'first', block: block.id },
      })),
    });
    minimal.reduce(second);
    expect(
      (renderDraft(prepared, second, run).spec.metadata as { generated: unknown }).generated,
    ).toMatchObject({ reduced_ends: reduction });
    // The blocks that stay are the walk's own first moves.
    expect(second.blocks.map((block) => block.id)).toEqual(
      first.blocks.slice(0, second.blocks.length).map((block) => block.id),
    );
  });

  it('keeps a walk whose end is said by no written walk', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const only = walk(prepared, 'only', path);
    const length = only.blocks.length;
    minimal.reduce(only);
    expect(only.blocks).toHaveLength(length);
  });

  it('never reduces a walk that reaches an end state', () => {
    const prepared = fixture();
    const base = prepared.relations.paths[0];
    if (!base) throw new Error('missing parcel path');
    const path = { ...base, end_state: { source: 'tool:ship', mode: 'exact' as const, expect: {} } };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(first.blocks.length);
  });

  it('counts the tuples of every seeder: a walk another seeder covers is cut like any other', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise');
    const second = walk(prepared, 'second', path, 'boundary');
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks.length).toBeLessThan(length);
  });

  it("keeps a block that injects a class, which is that class's test and the deviation of its row", () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const probe = (id: string) => {
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'twise',
        id,
        [],
        { preferred: [path], others: [] },
        { probe: { classId: 'D5_language_switch', stage: 'address' } },
      );
      if (!('draft' in built)) throw new Error(`${id} did not build`);
      return built.draft;
    };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = probe('first');
    const second = probe('second');
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    // The repeated blocks after the probe go; the block that injects the class never does.
    expect(second.blocks.length).toBeLessThan(length);
    expect(second.blocks.some((block) => block.injection)).toBe(true);
  });

  it('keeps the end of a walk that says another turn than any written block', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = walk(prepared, 'second', path);
    const last = second.blocks.at(-1);
    if (last?.stimulus.kind !== 'phrase') throw new Error('the last block says no phrase');
    last.stimulus = {
      ...last.stimulus,
      phrase: { ...last.stimulus.phrase, text: 'Pack it now, thank you.' },
    };
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(length);
  });

  it('keeps the end of a walk that places a tuple no written walk places', () => {
    const prepared = split();
    const send = prepared.relations.paths.find((path) => path.flow === 'send');
    const track = prepared.relations.paths.find((path) => path.flow === 'track');
    if (!send || !track) throw new Error('missing paths');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const long = walk(prepared, 'long', send);
    const short = walk(prepared, 'short', track);
    const length = short.blocks.length;
    minimal.reduce(long);
    minimal.reduce(short);
    // Its moves repeat the long walk's, but the tracking flow at the last stage is placed by this walk only.
    expect(short.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption and metamorphic families', () => {
  const member = (draft: ReturnType<typeof walk>, family: string, variant: number) => {
    draft.metamorphic = { family, variant, of: 2, relation: 'same observed outcome' };
    draft.perturbations = undefined;
    return draft;
  };

  it('cuts the first variant of a family like any walk, and the other variants to the same length', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path);
    written.perturbations = undefined;
    const first = member(walk(prepared, 'f-1', path, 'metamorphic'), 'f', 1);
    const second = member(walk(prepared, 'f-2', path, 'metamorphic'), 'f', 2);
    const length = written.blocks.length;
    for (const draft of [written, first, second]) minimal.reduce(draft);
    expect(written.blocks).toHaveLength(length);
    expect(first.blocks.length).toBeLessThan(length);
    // The family differs only in its phrasing: its variants have the same number of blocks.
    expect(second.blocks).toHaveLength(first.blocks.length);
  });

  it('names the retained family even when an ordinary walk wrote its blocks first', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'channel');
    const at = (channel: string): Array<[number, number]> => {
      const value = prepared.space.dimensions[dimension]?.index.get(channel);
      if (value === undefined) throw new Error(`missing channel ${channel}`);
      return [[dimension, value]];
    };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path, 'twise', at('counter'));
    const leader = member(walk(prepared, 'a-1', path, 'metamorphic', at('phone')), 'a', 1);
    const follower = member(walk(prepared, 'b-1', path, 'metamorphic', at('phone')), 'b', 1);
    minimal.reduce(written);
    minimal.reduce(leader);
    expect(leader.blocks).toHaveLength(written.blocks.length);
    minimal.reduce(follower);
    expect(follower.blocks.length).toBeLessThan(leader.blocks.length);
    const reduction = (
      renderDraft(prepared, follower, run).spec.metadata as {
        generated: { reduced_ends: { duplicates: unknown[] } };
      }
    ).generated.reduced_ends;
    for (const duplicate of reduction.duplicates)
      expect(duplicate).toMatchObject({ duplicate_of: { spec: 'a-1', family: 'a' } });
  });

  it('names an earlier family whose duplicate suffix was also cut, while keeping the written witness', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path);
    written.perturbations = undefined;
    const leader = member(walk(prepared, 'a-1', path, 'metamorphic'), 'a', 1);
    const follower = member(walk(prepared, 'b-1', path, 'metamorphic'), 'b', 1);
    const variant = member(walk(prepared, 'b-2', path, 'metamorphic'), 'b', 2);
    for (const draft of [written, leader, follower, variant]) minimal.reduce(draft);
    expect(leader.blocks.length).toBeLessThan(written.blocks.length);
    for (const draft of [follower, variant]) {
      const reduction = (
        renderDraft(prepared, draft, run).spec.metadata as {
          generated: { reduced_ends: { duplicates: unknown[] } };
        }
      ).generated.reduced_ends;
      for (const duplicate of reduction.duplicates)
        expect(duplicate).toMatchObject({
          duplicate_family: 'a',
          duplicate_of: { spec: 'written' },
        });
    }
  });

  it('cuts a follower exactly one block longer than its reduced leader', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path);
    written.perturbations = undefined;
    const first = member(walk(prepared, 'f-1', path, 'metamorphic'), 'f', 1);
    const second = member(walk(prepared, 'f-2', path, 'metamorphic'), 'f', 2);
    first.blocks = first.blocks.slice(0, 2);
    second.blocks = second.blocks.slice(0, 2);
    minimal.reduce(written);
    minimal.reduce(first);
    expect(second.blocks.length).toBe(first.blocks.length + 1);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(first.blocks.length);
  });

  it('keeps a family whole when its first variant ends on a block no written walk says', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = member(walk(prepared, 'f-1', path, 'metamorphic'), 'f', 1);
    const second = member(walk(prepared, 'f-2', path, 'metamorphic'), 'f', 2);
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
  });

  it('cuts a second family that ends on the same block as the first: two families are not two tests', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const one = [1, 2].map((v) => member(walk(prepared, `a-${v}`, path, 'metamorphic'), 'a', v));
    const two = [1, 2].map((v) => member(walk(prepared, `b-${v}`, path, 'metamorphic'), 'b', v));
    const length = one[0]?.blocks.length ?? 0;
    for (const draft of [...one, ...two]) minimal.reduce(draft);
    expect(one.map((draft) => draft.blocks.length)).toEqual([length, length]);
    expect(two.map((draft) => draft.blocks.length)[0]).toBeLessThan(length);
    expect(two[1]?.blocks).toHaveLength(two[0]?.blocks.length ?? -1);
    for (const draft of two) {
      const reduction = (
        renderDraft(prepared, draft, run).spec.metadata as {
          generated: { reduced_ends: { from_blocks: number; to_blocks: number; duplicates: unknown[] } };
        }
      ).generated.reduced_ends;
      expect(reduction).toMatchObject({ from_blocks: length, to_blocks: draft.blocks.length });
      expect(reduction.duplicates).toHaveLength(length - draft.blocks.length);
      for (const duplicate of reduction.duplicates)
        expect(duplicate).toMatchObject({ duplicate_of: { spec: 'a-1', family: 'a' } });
    }
  });
});

describe('terminal subsumption and the perturbations a block carries', () => {
  const perturbedAt = (
    prepared: ReturnType<typeof fixture>,
    path: PathRelation,
    id: string,
    stage: string,
    classId = 'D5_language_switch',
  ) => {
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'twise',
      id,
      [],
      { preferred: [path], others: [] },
      { perturb: { classId, stage } },
    );
    if (!('draft' in built)) throw new Error(`${id} did not build`);
    return built.draft;
  };

  it('keeps the block a declared perturbation names, even when another walk declares the same class there', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = perturbedAt(prepared, path, 'first', 'packing');
    const second = perturbedAt(prepared, path, 'second', 'packing');
    const length = first.blocks.length;
    expect(second.perturbations?.[0]?.inject_at).toBe(length - 1);
    minimal.reduce(first);
    minimal.reduce(second);
    // A perturbed run checks the recovery with the blocks around it: the walk is not cut below its declaration.
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    for (const entry of second.perturbations ?? [])
      expect(entry.inject_at).toBeLessThan(second.blocks.length);
  });

  it('reads a block as the same test whatever perturbations its walk declares before it', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const plain = walk(prepared, 'plain', path);
    plain.perturbations = undefined;
    // The same walk declares a class at its second stage, well before its end: the end is the same test.
    const declared = perturbedAt(prepared, path, 'declared', 'address');
    const length = declared.blocks.length;
    expect(declared.perturbations?.[0]?.inject_at).toBeLessThan(length - 1);
    minimal.reduce(plain);
    minimal.reduce(declared);
    expect(plain.blocks).toHaveLength(length);
    expect(declared.blocks.length).toBeLessThan(length);
    for (const entry of declared.perturbations ?? [])
      expect(entry.inject_at).toBeLessThan(declared.blocks.length);
  });

  it('keeps the block when no other written walk places the class it declares', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const plain = walk(prepared, 'plain', path);
    plain.perturbations = undefined;
    const declared = perturbedAt(prepared, path, 'declared', 'packing');
    const length = declared.blocks.length;
    minimal.reduce(plain);
    minimal.reduce(declared);
    expect(declared.blocks).toHaveLength(length);
    expect(declared.perturbations).toHaveLength(1);
  });
});

describe('terminal subsumption and the context a walk is written in', () => {
  const channelPick = (prepared: ReturnType<typeof twoChannels>, value: string): [number, number] => {
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'channel');
    const at = prepared.space.dimensions[dimension]?.index.get(value);
    if (at === undefined) throw new Error(`no channel ${value}`);
    return [dimension, at];
  };

  it('cuts the end of a walk another channel writes, once the path keeps a pair of whole walks per channel', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise', [channelPick(prepared, 'counter')]);
    const second = walk(prepared, 'second', path, 'twise', [channelPick(prepared, 'phone')]);
    const third = walk(prepared, 'third', path, 'twise', [channelPick(prepared, 'phone')]);
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    minimal.reduce(third);
    // The Then must hold across channels: the pair first/second stays whole. A third walk adds nothing.
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    expect(third.blocks.length).toBeLessThan(length);
  });

  it('keeps a pair of twins only on one path: a walk of another path with the same blocks is a repeat', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // The phone tuples are held by a phone walk that ends on another block, so only the twin rule can keep the copy.
    const written = walk(prepared, 'written', path, 'twise', [channelPick(prepared, 'counter')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const other = walk(prepared, 'other', path, 'twise', [channelPick(prepared, 'phone')]);
    // The same blocks as the first walk, said on another channel, but walked on another path: no twin of it.
    other.path = 'another-path';
    const length = other.blocks.length;
    for (const draft of [written, holder, other]) minimal.reduce(draft);
    expect(other.blocks.length).toBeLessThan(length);
  });

  it('keeps a twin on the same path whole: the control of the case above', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = walk(prepared, 'written', path, 'twise', [channelPick(prepared, 'counter')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const twin = walk(prepared, 'twin', path, 'twise', [channelPick(prepared, 'phone')]);
    const length = twin.blocks.length;
    for (const draft of [written, holder, twin]) minimal.reduce(draft);
    expect(twin.blocks).toHaveLength(length);
  });

  it('reads a block as the same test on any channel: the end a walk on the counter says is a repeat on the phone', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    // Only the counter walk says this end. The phone tuples are held by a phone walk that ends on another block,
    // so the phone walk below is a repeat of the counter walk's end and of nothing written on the phone.
    const written = walk(prepared, 'written', path, 'twise', [channelPick(prepared, 'counter')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const again = reworded(walk(prepared, 'again', path, 'twise', [channelPick(prepared, 'phone')]));
    const length = again.blocks.length;
    for (const draft of [written, holder, again]) minimal.reduce(draft);
    expect(again.blocks.length).toBeLessThan(length);
  });

  it('keeps one pair of whole twins per path even when other walks already hold their tuples', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    // A reworded phone walk holds the phone tuples; then a counter walk and its phone twin arrive.
    const holder = reworded(walk(prepared, 'holder', path, 'twise', [channelPick(prepared, 'phone')]));
    const counter = walk(prepared, 'counter', path, 'twise', [channelPick(prepared, 'counter')]);
    const twin = walk(prepared, 'twin', path, 'twise', [channelPick(prepared, 'phone')]);
    const length = twin.blocks.length;
    for (const draft of [holder, counter, twin]) minimal.reduce(draft);
    expect(counter.blocks).toHaveLength(length);
    expect(twin.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption and the persona a walk is written for', () => {
  const personaPick = (prepared: ReturnType<typeof twoPersonas>, value: string): [number, number] => {
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'persona');
    const at = prepared.space.dimensions[dimension]?.index.get(value);
    if (at === undefined) throw new Error(`no persona ${value}`);
    return [dimension, at];
  };

  it('cuts the end of a third walk once the path keeps a pair of whole walks per persona', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'twise', [personaPick(prepared, 'novice')]);
    const second = walk(prepared, 'second', path, 'twise', [personaPick(prepared, 'expert')]);
    const third = walk(prepared, 'third', path, 'twise', [personaPick(prepared, 'expert')]);
    const length = first.blocks.length;
    for (const draft of [first, second, third]) minimal.reduce(draft);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
    expect(third.blocks.length).toBeLessThan(length);
  });

  it('keeps one pair of whole twins per path even when other walks already hold their tuples', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    // A reworded expert walk holds the expert tuples; then a novice walk and its expert twin arrive.
    const holder = reworded(walk(prepared, 'holder', path, 'twise', [personaPick(prepared, 'expert')]));
    const novice = walk(prepared, 'novice', path, 'twise', [personaPick(prepared, 'novice')]);
    const twin = walk(prepared, 'twin', path, 'twise', [personaPick(prepared, 'expert')]);
    const length = twin.blocks.length;
    for (const draft of [holder, novice, twin]) minimal.reduce(draft);
    expect(novice.blocks).toHaveLength(length);
    expect(twin.blocks).toHaveLength(length);
  });

  it('reads a block as the same test for any persona: the end a novice walk says is a repeat for an expert', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = walk(prepared, 'written', path, 'twise', [personaPick(prepared, 'novice')]);
    const holder = endsElsewhere(walk(prepared, 'holder', path, 'twise', [personaPick(prepared, 'expert')]));
    const again = reworded(walk(prepared, 'again', path, 'twise', [personaPick(prepared, 'expert')]));
    const length = again.blocks.length;
    for (const draft of [written, holder, again]) minimal.reduce(draft);
    expect(again.blocks.length).toBeLessThan(length);
  });
});

describe('terminal subsumption and the block a walk ends on', () => {
  // A walk probes a class at the second stage: the block that injects it stays, so a cut stops on it.
  const probe = (prepared: ReturnType<typeof fixture>, path: PathRelation, id: string) => {
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'twise',
      id,
      [],
      { preferred: [path], others: [] },
      { probe: { classId: 'D5_language_switch', stage: 'address' } },
    );
    if (!('draft' in built)) throw new Error(`${id} did not build`);
    return built.draft;
  };
  const injectedAt = (draft: ReturnType<typeof probe>) => draft.blocks.findIndex((block) => block.injection);

  it('takes a cut back to the deepest cut that ends elsewhere when another walk already ends on the block it stops at', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const [first, second, third] = ['first', 'second', 'third'].map((id) => probe(prepared, path, id));
    if (!first || !second || !third) throw new Error('missing probes');
    const length = first.blocks.length;
    for (const draft of [first, second, third]) minimal.reduce(draft);
    const injected = injectedAt(second);
    expect(injected).toBeGreaterThan(0);
    expect(first.blocks).toHaveLength(length);
    // The second walk is cut to the block that injects the class, and ends there: one walk ends on that block.
    expect(second.blocks).toHaveLength(injected + 1);
    // The third would end there too: it keeps one block more, which ends on a block no walk ends on.
    expect(third.blocks).toHaveLength(injected + 2);
    expect(third.blocks.map((block) => block.id)).toEqual(
      first.blocks.slice(0, injected + 2).map((block) => block.id),
    );
  });

  it('keeps a walk whole when every cut of it ends on a block another walk ends on', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const drafts = ['first', 'second', 'third', 'fourth'].map((id) => probe(prepared, path, id));
    const [first, second, third, fourth] = drafts;
    if (!first || !second || !third || !fourth) throw new Error('missing probes');
    const length = first.blocks.length;
    for (const draft of drafts) minimal.reduce(draft);
    const injected = injectedAt(second);
    expect([second.blocks.length, third.blocks.length]).toEqual([injected + 1, injected + 2]);
    // Its cuts end on the blocks the second and the third walk end on, and its whole walk on the first walk's.
    expect(fourth.blocks).toHaveLength(length);
  });

  it('never cuts a walk to end on the request that follows a restated value', () => {
    const prepared = desk([
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'weighing', 'receipt'],
        classes: ['D5_language_switch'],
      },
    ]);
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const whole = walk(prepared, 'whole', path);
    const again = walk(prepared, 'again', path);
    // The second block asks the value again: the move after it is the test of the latest value.
    const restated = again.blocks[1];
    if (!restated) throw new Error('missing second block');
    restated.id = `${restated.id}-restated`;
    for (const draft of [whole, again]) minimal.reduce(draft);
    // Without the guard the walk is cut to its first block; with it, it stops on the move after the restated request.
    expect(again.blocks).toHaveLength(3);
  });
});

describe('terminal subsumption and the wording of a turn', () => {
  const prepared = fixture();
  const path = prepared.relations.paths[0];
  if (!path) throw new Error('missing parcel path');
  // A declared perturbation on the last block keeps it (see the perturbation cases): these walks declare none.
  const plain = (id: string) => {
    const draft = walk(prepared, id, path);
    draft.perturbations = undefined;
    return draft;
  };

  it('reads two blocks that differ only in the wording of the user turn as one test', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = plain('written');
    // The second walk ends on the words the first walk says in its middle: the same test, in words already said.
    const again = lastWordedAs(plain('again'), textOf(written, 1));
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks.length).toBeLessThan(length);
  });

  it('keeps the end of a block whose wording no written spec says: the phrase would be lost', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = plain('written');
    const again = lastWordedAs(plain('again'), 'Pack it now, thank you.');
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks).toHaveLength(length);
  });

  it('keeps the end of a block that expects another Then, however alike the turn reads', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = plain('written');
    const other = endsElsewhere(plain('other'));
    const length = other.blocks.length;
    minimal.reduce(written);
    minimal.reduce(other);
    expect(other.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption keeps what only the cut block checks or says', () => {
  const prepared = fixture();
  const path = prepared.relations.paths[0];
  if (!path) throw new Error('missing parcel path');
  const plain = (id: string, seeder: SpecDraft['seeder'] = 'twise') => {
    const draft = walk(prepared, id, path, seeder);
    draft.perturbations = undefined;
    return draft;
  };

  const member = (draft: ReturnType<typeof walk>, family: string, variant: number) => {
    draft.metamorphic = { family, variant, of: 2, relation: 'same observed outcome' };
    return draft;
  };

  it('keeps the end of a block that holds a gating criterion no written spec holds', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = plain('written');
    const gated = plain('gated');
    gated.criteria = [
      ...gated.criteria,
      { name: 'signed-total', rubric: 'The reply states the signed total.' },
    ];
    const last = gated.blocks.at(-1);
    if (!last) throw new Error('the walk has no block');
    last.criteria = [...(last.criteria ?? []), 'signed-total@gating'];
    const length = gated.blocks.length;
    minimal.reduce(written);
    minimal.reduce(gated);
    // Equal machine expectations are not equal Thens: the criterion is a check only this block carries.
    expect(gated.blocks).toHaveLength(length);
  });

  it('keeps the suffix of a metamorphic follower that says a message no written spec says', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const written = plain('written');
    const first = member(plain('f-1', 'metamorphic'), 'f', 1);
    const second = lastWordedAs(member(plain('f-2', 'metamorphic'), 'f', 2), 'Pack it now, thank you.');
    const length = second.blocks.length;
    minimal.reduce(written);
    minimal.reduce(first);
    expect(first.blocks.length).toBeLessThan(length);
    minimal.reduce(second);
    // The leader's cut is not the follower's: cutting it would lose the only place that message is said.
    expect(second.blocks).toHaveLength(length);
  });
});

describe('terminal subsumption and a stay in the middle of a walk', () => {
  const prepared = fixture();
  const path = prepared.relations.paths[0];
  if (!path) throw new Error('missing parcel path');
  const plain = (id: string) => {
    const draft = walk(prepared, id, path);
    draft.perturbations = undefined;
    return draft;
  };
  // The second block leaves the walk at the stage the first one reached: a stay.
  const stayAt = (draft: ReturnType<typeof walk>, index: number) => {
    const before = draft.blocks[index - 1];
    const block = draft.blocks[index];
    if (!before || !block) throw new Error('the walk is too short');
    block.stage = before.stage;
    return draft;
  };
  const idsOf = (draft: ReturnType<typeof walk>) => draft.blocks.map((block) => block.id);

  it('cuts a stay from the middle of a walk when a written spec already says it', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = stayAt(plain('written'), 1);
    const again = endsElsewhere(stayAt(plain('again'), 1));
    const stay = required(again.blocks[1]).id;
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks).toHaveLength(length - 1);
    expect(idsOf(again)).not.toContain(stay);
    expect(again.reducedMiddle).toEqual([{ block: stay, duplicate_of: expect.any(Object) }]);
  });

  it('keeps a stay no written spec says', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = plain('written');
    const again = endsElsewhere(stayAt(plain('again'), 1));
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks).toHaveLength(length);
  });

  it('keeps a stay that sets its own world: the next block would not start from the same Given', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = stayAt(plain('written'), 1);
    const again = endsElsewhere(stayAt(plain('again'), 1));
    required(again.blocks[1]).given = { world: { tools: { lookup: { result: { found: false } } } } };
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks).toHaveLength(length);
  });

  it('keeps a block that moves the walk to another stage', () => {
    const minimal = new TerminalSubsumption(prepared, run, 2);
    minimal.cutsOpenings = false;
    const written = plain('written');
    const again = endsElsewhere(plain('again'));
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.blocks).toHaveLength(length);
  });

  it('records the length the walk is written with when it is cut at the end and in the middle', () => {
    const long = desk([
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'weighing', 'sealing', 'receipt'],
        classes: ['D5_language_switch'],
      },
    ]);
    const longPath = long.relations.paths[0];
    if (!longPath) throw new Error('missing parcel path');
    const plainLong = (id: string) => {
      const draft = walk(long, id, longPath);
      draft.perturbations = undefined;
      return draft;
    };
    const minimal = new TerminalSubsumption(long, run, 2);
    minimal.cutsOpenings = false;
    const written = stayAt(plainLong('written'), 1);
    // The end of this walk is said by the first one, its fourth block is not, and its second block is a stay.
    const again = stayAt(plainLong('again'), 1);
    const fourth = required(again.blocks[3]);
    fourth.must_not = [...(fourth.must_not ?? []), 'a parcel weighing'];
    const length = again.blocks.length;
    minimal.reduce(written);
    minimal.reduce(again);
    expect(again.reducedMiddle).toHaveLength(1);
    expect(again.reducedEnds).toBeDefined();
    expect(again.blocks).toHaveLength(length - 2);
    expect(again.reducedEnds?.to_blocks).toBe(again.blocks.length);
  });
  it('starts a walk after the opening an earlier walk says, and writes the stage it starts at', () => {
    const long = desk([
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'weighing', 'sealing', 'receipt'],
        classes: ['D5_language_switch'],
      },
    ]);
    const longPath = long.relations.paths[0];
    if (!longPath) throw new Error('missing parcel path');
    const plain = (id: string) => {
      const draft = walk(long, id, longPath);
      draft.perturbations = undefined;
      return draft;
    };
    const minimal = new TerminalSubsumption(long, run, 2);
    const written = plain('written');
    // The end of this walk is its own: it shares every block but the last with the first one.
    const later = plain('later');
    const end = required(later.blocks.at(-1));
    end.must_not = [...(end.must_not ?? []), 'a parcel weighing'];
    minimal.reduce(written);
    minimal.reduce(later);
    const opening = later.reducedOpening;
    expect(opening?.of).toBe('written');
    expect(opening?.blocks).toBeGreaterThan(0);
    const first = required(later.blocks[0]);
    expect(first.given?.stage).toBe(required(written.blocks[(opening?.blocks ?? 0) - 1]).stage);
    expect(first.given?.prefix?.length).toBeGreaterThan(0);
    expect(first.given?.origin).toBe('canonical');
    // It names the block of the earlier walk that leaves the agent at that stage.
    const named = written.blocks[(opening?.blocks ?? 0) - 1];
    expect(first.given?.after).toBe(`${opening?.of}#${named?.id}`);
  });

  it('keeps the opening of a walk that declares a perturbation', () => {
    const long = desk([
      {
        id: 'parcel',
        stages: ['welcome', 'address', 'packing', 'weighing', 'sealing', 'receipt'],
        classes: ['D5_language_switch'],
      },
    ]);
    const longPath = long.relations.paths[0];
    if (!longPath) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(long, run, 2);
    const written = walk(long, 'written', longPath);
    written.perturbations = undefined;
    const later = walk(long, 'later', longPath);
    const end = required(later.blocks.at(-1));
    end.must_not = [...(end.must_not ?? []), 'a parcel weighing'];
    expect(later.perturbations?.length).toBeGreaterThan(0);
    minimal.reduce(written);
    minimal.reduce(later);
    expect(later.reducedOpening).toBeUndefined();
  });
});
