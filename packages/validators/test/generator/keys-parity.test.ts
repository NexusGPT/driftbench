import {
  type BlockSpec,
  canonicalGiven,
  canonicalJson,
  contentHash,
  deviationOf,
  type Message,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { machineSignature as generatorSignature } from '@agent-nexus/driftbench-generate';
import * as space from '@agent-nexus/driftbench-space';
import { beforeAll, describe, expect, it } from 'vitest';
import { SeedData } from '../../src/ladders/generator/bank';
import * as measure from '../../src/ladders/generator/measure';

/**
 * The same-test key, the walk and the words of a spec are defined once, in `packages/space/src/obligations/keys.ts`,
 * and the generator and this oracle both call them. This file keeps the code they replaced, as a test-only copy, and
 * holds the shared functions to it on every block of a generated suite, in a book of the whole suite and in a book of
 * nothing. The oracle's own key, `sameTestKey`, is built from the same parts and is not touched.
 */

// ---- the code that was in measure.ts and generate/gate/then.ts, verbatim ---------------------------------------

function legacySignature(spec: Spec, index: number): string {
  const block: BlockSpec | undefined = spec.blocks[index];
  const { criteria: _criteria, ledger_add: _ledger, ...machine } = block?.expect ?? {};
  const rules = spec.rules ? { ...spec.rules } : undefined;
  const last = index === spec.blocks.length - 1;
  return canonicalJson({
    expect: machine,
    ...(rules ? { rules } : {}),
    ...(last && spec.end_state !== undefined ? { end_state: spec.end_state } : {}),
  });
}

function squeeze(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function legacyWordsOf(spec: Spec): string {
  return contentHash(
    spec.blocks.map((block, index) => {
      const when = block.when;
      const turn =
        when === undefined
          ? null
          : 'user' in when
            ? { user: squeeze(when.user) }
            : 'burst' in when
              ? { burst: when.burst.map(squeeze) }
              : { injection: { class: when.injection.class, user: squeeze(when.injection.user ?? '') } };
      const given = canonicalGiven(spec, index);
      return [
        turn,
        given.state,
        given.prefix.map((message) => ({ ...message, content: squeeze(message.content) })),
      ];
    }),
  );
}

function legacyAnswersOf(spec: Spec, index: number): string {
  const world = canonicalGiven(spec, index).state.world as { tools?: unknown } | undefined;
  return contentHash(world?.tools ?? null);
}

type LegacyBook = Map<string, { stage: string; history: string }>;

function historyKey(history: readonly Message[]): string {
  return contentHash(history.map((message) => (message.role === 'user' ? { role: 'user' } : message)));
}

function legacyStageBookOf(specs: readonly Spec[]): LegacyBook {
  const book: LegacyBook = new Map();
  for (const spec of specs)
    spec.blocks.forEach((block, index) => {
      const stage = block.expect?.stage;
      if (stage === undefined || block.id === undefined) return;
      book.set(`${spec.id}#${block.id}`, {
        stage,
        history: historyKey(canonicalGiven(spec, index + 1).prefix),
      });
    });
  return book;
}

function legacyDeclaredStageBefore(spec: Spec, index: number, book: LegacyBook): string | undefined {
  for (let at = index; at >= 0; at -= 1) {
    const block = spec.blocks[at];
    if (at < index && block?.expect?.stage !== undefined) return block.expect.stage;
    const given = block?.given;
    if (given?.stage === undefined || given.prefix === undefined || given.after === undefined) continue;
    const named = book.get(given.after);
    if (named?.stage === given.stage && named.history === historyKey(given.prefix)) return given.stage;
  }
  return undefined;
}

function legacyStartStageOf(spec: Spec, index: number, book: LegacyBook): string {
  return (
    legacyDeclaredStageBefore(spec, index, book) ??
    (index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage) ??
    ''
  );
}

/** The fields runAll computed inline for each block, before the builder. */
function legacyFacts(spec: Spec, index: number, book: LegacyBook) {
  const block = spec.blocks[index] as BlockSpec;
  const meta = spec.metadata?.generated as
    | { path?: string; metamorphic?: { family?: string; variant?: number; of?: number } }
    | undefined;
  return {
    deviation: deviationOf(spec, index),
    injected: 'injection' in (block.when ?? {}),
    path: meta?.path ?? '',
    walk: contentHash(
      spec.blocks.map((_, at) => [
        legacyAnswersOf(spec, at),
        legacyStartStageOf(spec, at, book),
        legacySignature(spec, at),
      ]),
    ),
    channel: spec.channel ?? '',
    persona: (spec.tags ?? []).filter((tag) => tag.startsWith('persona:')).join(','),
    of: meta?.metamorphic?.of ?? 0,
    words: legacyWordsOf(spec),
    variant: meta?.metamorphic?.variant ?? 0,
    family: meta?.metamorphic?.family ?? '',
    perturbed: (spec.perturbations ?? [])
      .filter((entry) => entry.inject_at >= index)
      .map((entry) => entry.class)
      .sort()
      .join(','),
  };
}

// ---- the parity ------------------------------------------------------------------------------------------------

/**
 * A walk that starts where another leaves off, as a cut walk does: its first block declares the stage it starts from,
 * the history of the walk it comes from, and the block it takes them from.
 */
function cutOpening(source: Spec): Spec | undefined {
  const first = source.stages?.[0];
  const at = source.blocks.findIndex(
    (block, index) => index >= 1 && index + 1 < source.blocks.length && block.expect?.stage !== first,
  );
  const named = source.blocks[at];
  if (at < 0 || named?.id === undefined || named.expect?.stage === undefined) return undefined;
  const copy = structuredClone(source);
  copy.id = `${source.id}-cut`;
  copy.blocks = copy.blocks.slice(at + 1);
  const head = copy.blocks[0] as BlockSpec;
  const history = canonicalGiven(source, at + 1).prefix;
  head.given = {
    prefix: history,
    origin: 'canonical',
    stage: named.expect.stage,
    after: `${source.id}#${named.id}`,
  };
  copy.perturbations = undefined;
  return copy;
}

describe('the shared key, walk and words are the code they replaced', () => {
  let specs: Spec[] = [];

  beforeAll(async () => {
    const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
    specs = generated.complete.map((entry) => entry.spec);
    const cuts = specs.flatMap((spec) => cutOpening(spec) ?? []).slice(0, 20);
    specs = [...specs, ...cuts];
  }, 600_000);

  it('reads a suite that has blocks, declared starts and perturbations to compare', () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(specs.some((spec) => spec.blocks[0]?.given?.after !== undefined)).toBe(true);
    expect(specs.some((spec) => (spec.perturbations ?? []).length > 0)).toBe(true);
    expect(specs.some((spec) => spec.blocks.some((block) => 'injection' in (block.when ?? {})))).toBe(true);
    expect(specs.some((spec) => spec.channel !== undefined)).toBe(true);
  });

  it('gives every block the signature, answers, start stage and key it had, in the book of the suite', () => {
    const legacy = legacyStageBookOf(specs);
    const book = space.stageBookOf(specs);
    expect([...book]).toEqual([...legacy]);
    for (const spec of specs) {
      spec.blocks.forEach((_, index) => {
        const where = `${spec.id}#${index}`;
        expect(space.machineSignature(spec, index), where).toBe(legacySignature(spec, index));
        expect(space.answersOf(spec, index), where).toBe(legacyAnswersOf(spec, index));
        expect(space.startStageOf(spec, index, book), where).toBe(legacyStartStageOf(spec, index, legacy));
        const start = legacyStartStageOf(spec, index, legacy);
        const parts = [legacyAnswersOf(spec, index), start, legacySignature(spec, index)];
        expect(space.testKeyOf(spec, index, book), where).toBe(JSON.stringify(parts));
      });
    }
  });

  it('gives every block the start stage it had in a book of nothing', () => {
    const legacy: LegacyBook = new Map();
    const book: space.StageBook = new Map();
    for (const spec of specs) {
      spec.blocks.forEach((_, index) => {
        const where = `${spec.id}#${index}`;
        expect(space.startStageOf(spec, index, book), where).toBe(legacyStartStageOf(spec, index, legacy));
      });
    }
  });

  it('gives every spec the walk and the words it had', () => {
    const legacy = legacyStageBookOf(specs);
    const book = space.stageBookOf(specs);
    for (const spec of specs) {
      expect(space.walkOf(spec, book), spec.id).toBe(legacyFacts(spec, 0, legacy).walk);
      expect(space.specWords(spec), spec.id).toBe(legacyWordsOf(spec));
    }
  });

  it('gives every block the facts runAll computed inline', () => {
    const legacy = legacyStageBookOf(specs);
    const book = space.stageBookOf(specs);
    for (const spec of specs) {
      const facts = space.obligationSpecOf(spec, book);
      spec.blocks.forEach((_, index) => {
        const before = legacyFacts(spec, index, legacy);
        const marks = facts.blocks[index];
        const where = `${spec.id}#${index}`;
        expect(
          {
            deviation: marks?.deviation,
            injected: marks?.injected,
            path: facts.path,
            walk: facts.walk,
            channel: facts.channel,
            persona: facts.persona,
            of: facts.of,
            words: facts.words,
            variant: facts.variant,
            family: facts.family,
            perturbed: (marks?.perturbed ?? []).join(','),
          },
          where,
        ).toEqual(before);
      });
    }
  });

  it('is one function: the generator, the oracle and the shared module export the same signature', () => {
    expect(generatorSignature).toBe(space.machineSignature);
    expect(measure.answersOf).toBe(space.answersOf);
    expect(measure.startStageOf).toBe(space.startStageOf);
    expect(measure.stageBookOf).toBe(space.stageBookOf);
    expect(measure.declaredStageBefore).toBe(space.declaredStageBefore);
    expect(measure.wordsOf).toBe(space.specWords);
  });
});
