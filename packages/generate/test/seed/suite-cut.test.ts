import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { addEventCodes, placeSpec } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import type { PathRelation } from '../../src/extract/proposal';
import { renderDraft, type SpecDraft } from '../../src/seed/assemble';
import { TerminalSubsumption } from '../../src/seed/minimal';
import { type SeedContext, scenarioDraft } from '../../src/seed/seed-drafts';
import { SuiteCut } from '../../src/seed/suite-cut';
import { fixture, twoChannels } from './desk';

const run = { seed: 1031, mapPath: '../desk.yaml' };

type Prepared = ReturnType<typeof fixture>;

/** A walk of the path, cut after `length` blocks as a seeder that stops early would have written it. */
function walk(prepared: Prepared, id: string, path: PathRelation, length: number): SpecDraft {
  const context: SeedContext = { seed: 1031, t: 2, max: 100 };
  const built = scenarioDraft(prepared, context, id, 'twise', id, [], { preferred: [path], others: [] });
  if (!('draft' in built)) throw new Error(`${id} did not build`);
  built.draft.perturbations = undefined;
  built.draft.blocks = built.draft.blocks.slice(0, length);
  return built.draft;
}

const specOf = (prepared: Prepared, draft: SpecDraft): Spec => {
  const parsed = validateSpec(renderDraft(prepared, draft, run).spec);
  if (!parsed.ok) throw new Error(`${draft.id} is not valid`);
  return parsed.spec;
};

/** The suite: walks of one path that stop at different lengths, and two that run to the end, ids in write order. */
function suite(prepared: Prepared, path: PathRelation): SpecDraft[] {
  return [
    walk(prepared, 'gen-twise-001', path, 2),
    walk(prepared, 'gen-twise-002', path, 3),
    walk(prepared, 'gen-twise-003', path, 2),
    walk(prepared, 'gen-twise-004', path, 3),
    // Two walks that say the same: one of them ends on the block, which one is the question.
    walk(prepared, 'gen-twise-005', path, 4),
    walk(prepared, 'gen-twise-006', path, 4),
  ];
}

function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('the tails of a suite, cut with the whole suite in view', () => {
  const setup = () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    return { prepared, path };
  };

  const lengthsOf = (drafts: readonly SpecDraft[]) =>
    Object.fromEntries(
      [...drafts].sort((a, b) => (a.id < b.id ? -1 : 1)).map((draft) => [draft.id, draft.blocks.length]),
    );

  it('cuts the same tails whatever order the walks were written in', () => {
    const { prepared, path } = setup();
    const results = [0, 1, 2, 3, 4, 5].map((seed) => {
      const drafts = shuffled(suite(prepared, path), seed);
      const items = drafts.map((draft) => ({ draft, spec: specOf(prepared, draft) }));
      const minimal = new TerminalSubsumption(prepared, run, 2);
      new SuiteCut(prepared, minimal).reduce(shuffled(items, seed + 100));
      return lengthsOf(drafts);
    });
    for (const result of results) expect(result).toEqual(results[0]);
    // The walks that stop at two blocks end on a block the longer ones pass through: they are cut to one.
    expect(Object.values(results[0] ?? {})).toContain(1);
  });

  it('cuts a tail that a walk written later passes through, which the first pass leaves', () => {
    const { prepared, path } = setup();
    const written = (order: string[]) => {
      const drafts = new Map(suite(prepared, path).map((draft) => [draft.id, draft]));
      const minimal = new TerminalSubsumption(prepared, run, 2);
      minimal.dropsSpecs = false;
      for (const id of order) minimal.reduce(drafts.get(id) as SpecDraft);
      return lengthsOf([...drafts.values()]);
    };
    // The first pass keeps the tail of the walk written before the longer one: its result depends on the order.
    expect(written(['gen-twise-001', 'gen-twise-002', 'gen-twise-003', 'gen-twise-004'])).not.toEqual(
      written(['gen-twise-002', 'gen-twise-004', 'gen-twise-001', 'gen-twise-003']),
    );
  });

  it('names, for every block it cut, a block the final suite still has', () => {
    const { prepared, path } = setup();
    const drafts = suite(prepared, path);
    const items = drafts.map((draft) => ({ draft, spec: specOf(prepared, draft) }));
    new SuiteCut(prepared, new TerminalSubsumption(prepared, run, 2)).reduce(items);
    const kept = new Map(drafts.map((draft) => [draft.id, new Set(draft.blocks.map((block) => block.id))]));
    for (const draft of drafts)
      for (const entry of draft.reducedEnds?.duplicates ?? [])
        expect(kept.get(entry.duplicate_of.spec)?.has(entry.duplicate_of.block)).toBe(true);
    expect(drafts.some((draft) => (draft.reducedEnds?.duplicates.length ?? 0) > 0)).toBe(true);
  });

  it('keeps every tuple the suite placed', () => {
    const { prepared, path } = setup();
    const drafts = suite(prepared, path);
    const items = drafts.map((draft) => ({ draft, spec: specOf(prepared, draft) }));
    const minimal = new TerminalSubsumption(prepared, run, 2);
    const placed = (specs: Spec[]) => {
      const codes = new Set<string>();
      for (const spec of specs) {
        const placement = placeSpec(minimal.space, spec);
        minimal.projections.forEach((projection, index) => {
          const found = new Set<number>();
          for (const event of placement.events) addEventCodes(projection, event, found);
          for (const code of found) if (projection.allowed[code] === 1) codes.add(`${index}:${code}`);
        });
      }
      return codes;
    };
    const before = placed(items.map((item) => item.spec));
    new SuiteCut(prepared, minimal).reduce(items);
    const after = placed(drafts.map((draft) => specOf(prepared, draft)));
    expect(after).toEqual(before);
  });

  it('keeps the first twin pair of a path whole', () => {
    const prepared = twoChannels();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    const channel = prepared.space.dimensions.findIndex((entry) => entry.kind === 'channel');
    const at = (name: string): Array<[number, number]> => {
      const value = prepared.space.dimensions[channel]?.index.get(name);
      if (value === undefined) throw new Error(`missing channel ${name}`);
      return [[channel, value]];
    };
    const context: SeedContext = { seed: 1031, t: 2, max: 100 };
    const twin = (id: string, name: string) => {
      const built = scenarioDraft(prepared, context, id, 'twise', id, at(name), {
        preferred: [path],
        others: [],
      });
      if (!('draft' in built)) throw new Error(`${id} did not build`);
      built.draft.perturbations = undefined;
      return built.draft;
    };
    const drafts = [
      twin('gen-twise-001', 'counter'),
      twin('gen-twise-002', 'phone'),
      twin('gen-twise-003', 'phone'),
    ];
    const length = drafts[0]?.blocks.length;
    const items = drafts.map((draft) => ({ draft, spec: specOf(prepared, draft) }));
    new SuiteCut(prepared, new TerminalSubsumption(prepared, run, 2)).reduce(items);
    expect(drafts[0]?.blocks).toHaveLength(length as number);
    expect(drafts[1]?.blocks).toHaveLength(length as number);
  });
});
