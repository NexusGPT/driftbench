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
function walk(
  prepared: Prepared,
  id: string,
  path: PathRelation,
  length: number,
  options: { perturbed?: boolean; same?: boolean } = {},
): SpecDraft {
  const context: SeedContext = { seed: 1031, t: 2, max: 100 };
  const built = scenarioDraft(
    prepared,
    context,
    id,
    'twise',
    id,
    [],
    { preferred: [path], others: [] },
    options.same ? { rngLabel: 'same' } : {},
  );
  if (!('draft' in built)) throw new Error(`${id} did not build`);
  if (!options.perturbed) built.draft.perturbations = undefined;
  built.draft.blocks = built.draft.blocks.slice(0, length);
  built.draft.perturbations = built.draft.perturbations?.filter((entry) => entry.inject_at <= length);
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

/** What is left of each walk: its length, the classes it still declares, or that it is no longer written. */
const shapeOf = (drafts: readonly SpecDraft[]) =>
  Object.fromEntries(
    [...drafts]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((draft) => [
        draft.id,
        draft.dropped
          ? 'dropped'
          : `${draft.blocks.length}${(draft.perturbations ?? []).map((entry) => `+${entry.class}@${entry.inject_at}`).join('')}`,
      ]),
  );

const cutSuite = (prepared: Prepared, drafts: SpecDraft[], order: number) => {
  const items = shuffled(
    drafts.map((draft) => ({ draft, spec: specOf(prepared, draft) })),
    order,
  );
  // The tails of these small suites are judged on what the suite owes; the balance of the strata has its own test.
  return new SuiteCut(prepared, new TerminalSubsumption(prepared, run, 2), { ignoreAllocation: true }).reduce(
    items,
  );
};

describe('the tails of a suite, cut with the whole suite in view', () => {
  const setup = () => {
    const prepared = fixture();
    const path = prepared.relations.paths[0];
    if (!path) throw new Error('missing parcel path');
    return { prepared, path };
  };

  it('cuts the same tails whatever order the walks were written in', () => {
    const { prepared, path } = setup();
    const results = [0, 1, 2, 3, 4, 5].map((order) => {
      const drafts = shuffled(suite(prepared, path), order);
      cutSuite(prepared, drafts, order + 100);
      return shapeOf(drafts);
    });
    for (const result of results) expect(result).toEqual(results[0]);
    // The walks that stop at two blocks end on a block the longer ones pass through: they are cut or dropped.
    expect(
      Object.values(results[0] ?? {}).filter((shape) => shape === 'dropped' || shape.startsWith('1')).length,
    ).toBeGreaterThan(0);
  });

  it('cuts the same tails whatever order the walks were written in, with declared perturbations', () => {
    const { prepared, path } = setup();
    const make = () => [
      walk(prepared, 'gen-twise-001', path, 3, { perturbed: true }),
      walk(prepared, 'gen-twise-002', path, 3, { perturbed: true }),
      walk(prepared, 'gen-twise-003', path, 2, { perturbed: true }),
      walk(prepared, 'gen-twise-004', path, 3),
    ];
    const results = [0, 1, 2, 3, 4, 5].map((order) => {
      const drafts = shuffled(make(), order);
      cutSuite(prepared, drafts, order + 100);
      return shapeOf(drafts);
    });
    for (const result of results) expect(result).toEqual(results[0]);
  });

  it('cuts a tail that a walk written later passes through, which the first pass leaves', () => {
    const { prepared, path } = setup();
    const written = (order: string[]) => {
      const drafts = new Map(suite(prepared, path).map((draft) => [draft.id, draft]));
      const minimal = new TerminalSubsumption(prepared, run, 2);
      minimal.dropsSpecs = false;
      for (const id of order) minimal.reduce(drafts.get(id) as SpecDraft);
      return shapeOf([...drafts.values()]);
    };
    // The first pass keeps the tail of the walk written before the longer one: its result depends on the order.
    expect(written(['gen-twise-001', 'gen-twise-002', 'gen-twise-003', 'gen-twise-004'])).not.toEqual(
      written(['gen-twise-002', 'gen-twise-004', 'gen-twise-001', 'gen-twise-003']),
    );
  });

  it('names, for every block it cut and every walk it dropped, a block the final suite still has', () => {
    const { prepared, path } = setup();
    const drafts = suite(prepared, path);
    cutSuite(prepared, drafts, 0);
    const kept = new Map(
      drafts
        .filter((draft) => !draft.dropped)
        .map((draft) => [draft.id, new Set(draft.blocks.map((block) => block.id))]),
    );
    for (const draft of drafts) {
      for (const entry of draft.dropped ? [] : (draft.reducedEnds?.duplicates ?? []))
        expect(kept.get(entry.duplicate_of.spec)?.has(entry.duplicate_of.block)).toBe(true);
      if (draft.dropped)
        expect(kept.get(draft.dropped.duplicate_of.spec)?.has(draft.dropped.duplicate_of.block)).toBe(true);
    }
    expect(drafts.some((draft) => draft.dropped || (draft.reducedEnds?.duplicates.length ?? 0) > 0)).toBe(
      true,
    );
  });

  it('keeps every tuple the suite placed', () => {
    const { prepared, path } = setup();
    const drafts = suite(prepared, path);
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
    const before = placed(drafts.map((draft) => specOf(prepared, draft)));
    cutSuite(prepared, drafts, 0);
    const after = placed(drafts.filter((draft) => !draft.dropped).map((draft) => specOf(prepared, draft)));
    expect(after).toEqual(before);
  });

  it('drops a declaration with the block it is made at when another walk of the path declares the class', () => {
    const { prepared, path } = setup();
    const drafts = [
      walk(prepared, 'gen-twise-001', path, 3, { perturbed: true, same: true }),
      walk(prepared, 'gen-twise-002', path, 3, { perturbed: true, same: true }),
      walk(prepared, 'gen-twise-003', path, 3),
      walk(prepared, 'gen-twise-004', path, 3),
    ];
    const declared = (list: SpecDraft[]) =>
      new Set(
        list
          .filter((draft) => !draft.dropped)
          .flatMap((draft) => (draft.perturbations ?? []).map((entry) => entry.class)),
      );
    const before = declared(drafts);
    expect(before.size).toBeGreaterThan(0);
    cutSuite(prepared, drafts, 0);
    // One of the two walks is no longer written, or lost the declaration: the class is still declared by the other.
    expect(declared(drafts)).toEqual(before);
    const left = drafts.filter((draft) => !draft.dropped && (draft.perturbations?.length ?? 0) > 0);
    expect(left).toHaveLength(1);
  });

  it('keeps the only declaration of a class on a path', () => {
    const { prepared, path } = setup();
    const drafts = [
      walk(prepared, 'gen-twise-001', path, 3, { perturbed: true }),
      walk(prepared, 'gen-twise-002', path, 3),
    ];
    const length = drafts[0]?.blocks.length;
    const classes = drafts[0]?.perturbations?.map((entry) => entry.class);
    cutSuite(prepared, drafts, 0);
    expect(drafts[0]?.dropped).toBeUndefined();
    expect(drafts[0]?.perturbations?.map((entry) => entry.class)).toEqual(classes);
    expect(drafts[0]?.blocks.length).toBeGreaterThanOrEqual((length ?? 0) - 1);
  });

  it('drops a whole walk whose every block another walk holds, and keeps the one with the lowest id', () => {
    const { prepared, path } = setup();
    const drafts = [
      walk(prepared, 'gen-twise-001', path, 4, { same: true }),
      walk(prepared, 'gen-twise-002', path, 4, { same: true }),
      walk(prepared, 'gen-twise-003', path, 4, { same: true }),
    ];
    cutSuite(prepared, drafts, 3);
    expect(drafts.map((draft) => Boolean(draft.dropped))).toEqual([false, true, true]);
    expect(drafts[0]?.blocks.length).toBeGreaterThan(1);
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
    expect(drafts[0]?.dropped).toBeUndefined();
    expect(drafts[1]?.dropped).toBeUndefined();
  });

  describe('a metamorphic family', () => {
    const family = (prepared: Prepared, path: PathRelation, length: number, differAt: number) => {
      const variants = [1, 2].map((variant) => {
        const draft = walk(prepared, `gen-metamorphic-001-${variant}`, path, length);
        draft.seeder = 'metamorphic';
        draft.metamorphic = {
          family: 'gen-metamorphic-001',
          variant,
          of: 2,
          relation: 'same observed outcome',
        };
        draft.variesAt = differAt;
        if (variant === 2) {
          const block = draft.blocks[differAt];
          if (block?.stimulus.kind !== 'phrase') throw new Error('the block says no phrase');
          block.stimulus = {
            ...block.stimulus,
            phrase: { ...block.stimulus.phrase, text: 'Another way to say it.' },
          };
        }
        return draft;
      });
      return variants;
    };

    it('is cut as one unit when its variants still differ in what they keep', () => {
      const { prepared, path } = setup();
      const variants = family(prepared, path, 3, 0);
      const long = walk(prepared, 'gen-boundary-001', path, 3);
      const drafts = [long, ...variants];
      cutSuite(prepared, drafts, 0);
      expect(variants[0]?.blocks.length).toBe(variants[1]?.blocks.length);
      expect(variants[0]?.blocks.length).toBeLessThan(3);
      expect(variants[0]?.blocks.length).toBeGreaterThan(0);
    });

    it('keeps the block where its variants differ', () => {
      const { prepared, path } = setup();
      const variants = family(prepared, path, 3, 2);
      const long = walk(prepared, 'gen-boundary-001', path, 3);
      cutSuite(prepared, [long, ...variants], 0);
      expect(variants[0]?.blocks).toHaveLength(3);
      expect(variants[1]?.blocks).toHaveLength(3);
    });
  });
});
