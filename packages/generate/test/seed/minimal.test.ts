import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { PathRelation } from '../../src/extract/proposal';
import { renderDraft, type SpecDraft } from '../../src/seed/assemble';
import { TerminalSubsumption } from '../../src/seed/minimal';
import { type SeedContext, scenarioDraft } from '../../src/seed/seed-drafts';
import { fixture, split, twoChannels, twoPersonas } from './desk';

const run = { seed: 1031, mapPath: '../desk.yaml' };

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

// The Given of a block: the tool answers its world holds. Two blocks with other answers are other tests.
const answered = (draft: ReturnType<typeof walk>, index: number, found: boolean) => {
  const block = draft.blocks[index];
  if (!block) throw new Error('no such block');
  block.given = { world: { tools: { lookup: { result: { found } } } } };
  return draft;
};

// The same walk with other tool answers from its first block on: not a twin of any other walk, another Given.
const reworded = (draft: ReturnType<typeof walk>) => answered(draft, 0, false);

// The same walk with another tool answer at its last block only: it ends on a block no other walk ends on.
const endsElsewhere = (draft: ReturnType<typeof walk>) => answered(draft, draft.blocks.length - 1, false);

// The same turn worded another way: the user wording is not part of what a block is.
const wordedAnother = (draft: ReturnType<typeof walk>) => {
  const last = draft.blocks.at(-1);
  if (last?.stimulus.kind !== 'phrase') throw new Error('the last block says no phrase');
  last.stimulus = { ...last.stimulus, phrase: { ...last.stimulus.phrase, text: 'Pack it now, thank you.' } };
  return draft;
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

  it('keeps the end of a walk whose tool answers differ from any written block: another Given is another test', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = endsElsewhere(walk(prepared, 'second', path));
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks).toHaveLength(length);
  });

  it('cuts the end of a walk that only words its last turn another way: the wording is not part of the test', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path);
    const second = wordedAnother(walk(prepared, 'second', path));
    const length = second.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(second.blocks.length).toBeLessThan(length);
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

describe('terminal subsumption keeps walks apart', () => {
  it('never cuts a metamorphic variant, so a family differs only in its phrasing', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const first = walk(prepared, 'first', path, 'metamorphic');
    const second = walk(prepared, 'second', path, 'metamorphic');
    const length = first.blocks.length;
    minimal.reduce(first);
    minimal.reduce(second);
    expect(first.blocks).toHaveLength(length);
    expect(second.blocks).toHaveLength(length);
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

  it('keeps one pair of whole twins per path even when other walks already hold their tuples', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const minimal = new TerminalSubsumption(prepared, run, 2);
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
    // A reworded expert walk holds the expert tuples; then a novice walk and its expert twin arrive.
    const holder = reworded(walk(prepared, 'holder', path, 'twise', [personaPick(prepared, 'expert')]));
    const novice = walk(prepared, 'novice', path, 'twise', [personaPick(prepared, 'novice')]);
    const twin = walk(prepared, 'twin', path, 'twise', [personaPick(prepared, 'expert')]);
    const length = twin.blocks.length;
    for (const draft of [holder, novice, twin]) minimal.reduce(draft);
    expect(novice.blocks).toHaveLength(length);
    expect(twin.blocks).toHaveLength(length);
  });
});

describe('what makes two blocks the same test', () => {
  const identity = (
    prepared: ReturnType<typeof fixture>,
    draft: ReturnType<typeof walk>,
    index = draft.blocks.length - 1,
  ) => {
    const parsed = validateSpec(renderDraft(prepared, draft, run).spec);
    if (!parsed.ok) throw new Error('the walk is not a valid spec');
    return new TerminalSubsumption(prepared, run, 2).identity(parsed.spec, index);
  };

  it('is the Given, the stage and cell and the Then: the same block on another channel is the same test', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'channel');
    const on = (value: string) =>
      [[dimension, prepared.space.dimensions[dimension]?.index.get(value) as number]] as Array<
        [number, number]
      >;
    const counter = walk(prepared, 'a', path, 'twise', on('counter'));
    const phone = walk(prepared, 'b', path, 'twise', on('phone'));
    expect(identity(prepared, phone)).toBe(identity(prepared, counter));
  });

  it('is the same for another persona', () => {
    const prepared = twoPersonas();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const dimension = prepared.space.dimensions.findIndex((entry) => entry.kind === 'persona');
    const as = (value: string) =>
      [[dimension, prepared.space.dimensions[dimension]?.index.get(value) as number]] as Array<
        [number, number]
      >;
    const novice = walk(prepared, 'a', path, 'twise', as('novice'));
    const expert = walk(prepared, 'b', path, 'twise', as('expert'));
    expect(identity(prepared, expert)).toBe(identity(prepared, novice));
  });

  it('is the same whatever perturbations the walk declares before the block', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const plain = walk(prepared, 'a', path);
    plain.perturbations = undefined;
    const declared = walk(prepared, 'b', path);
    declared.perturbations = [
      {
        id: 'p1',
        class: 'D5_language_switch',
        inject_at: 0,
        user: 'Kunt u mij helpen?',
        expect: { stage: 'welcome' },
        recovery: { within_blocks: 0, stage_after: 'welcome' },
      },
    ] as never;
    expect(identity(prepared, declared)).toBe(identity(prepared, plain));
  });

  it('is the same however the user words the turn (wording variants are the metamorphic family)', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const base = walk(prepared, 'a', path);
    const other = wordedAnother(walk(prepared, 'b', path));
    expect(identity(prepared, other)).toBe(identity(prepared, base));
  });

  it('differs when a tool answers another value: the block runs in another world', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const base = walk(prepared, 'a', path);
    const other = endsElsewhere(walk(prepared, 'b', path));
    expect(identity(prepared, other)).not.toBe(identity(prepared, base));
  });

  it('differs when the stage the block is said from differs', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const draft = walk(prepared, 'a', path);
    expect(identity(prepared, draft, 1)).not.toBe(identity(prepared, draft, 2));
  });

  it('differs when an earlier block set a tool answer the block runs in, though its own Given is empty', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const base = walk(prepared, 'a', path);
    const other = answered(walk(prepared, 'b', path), 0, false);
    expect(other.blocks.at(-1)?.given).toBeUndefined();
    expect(identity(prepared, other)).not.toBe(identity(prepared, base));
  });

  it('differs when the cell of the block differs', () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const parse = (draft: ReturnType<typeof walk>) => {
      const parsed = validateSpec(renderDraft(prepared, draft, run).spec);
      if (!parsed.ok) throw new Error('the walk is not a valid spec');
      return parsed.spec;
    };
    const spec = parse(walk(prepared, 'a', path));
    const last = spec.blocks.length - 1;
    const other = structuredClone(spec);
    const generated = other.metadata?.generated as
      | { blocks?: Array<{ cell?: Record<string, string> }> }
      | undefined;
    const entry = generated?.blocks?.[last];
    if (!entry?.cell) throw new Error('the block records no cell');
    entry.cell = { ...entry.cell, behaviour: 'another-value' };
    const minimal = new TerminalSubsumption(prepared, run, 2);
    expect(minimal.identity(other, last)).not.toBe(minimal.identity(spec, last));
  });
});
