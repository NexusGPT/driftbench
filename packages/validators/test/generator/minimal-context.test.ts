import { describe, expect, it } from 'vitest';
import { SeedData, vectorOf } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { type BlockRun, type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/** The vector before persona-bound faults: the Then and the outcome on the reference, cheaters and faults. */
const plainVector = (block: BlockRun) => vectorOf({ ...block, contextFaults: {} });

describe('minimality judges a block on the faults that depend on who the user is', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const { hidden } = generated;
  const phrases = hidden.phrases.filter((phrase) => phrase.intent.kind === 'persona');
  const speaking = generated.complete.filter(({ spec }) =>
    phrases.some((phrase) => JSON.stringify(spec.blocks).includes(phrase.text)),
  );
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const persona = required(
    hidden.personas.find((entry) => !cover.spec.tags?.includes(`persona:${entry.id}`)),
  );
  const channel = required(hidden.channels.find((entry) => entry !== cover.spec.channel));
  const copy = (id: string, relabel: boolean) => {
    const spec = structuredClone(cover.spec);
    spec.id = id;
    if (relabel) {
      spec.tags = spec.tags?.map((tag) => (tag.startsWith('persona:') ? `persona:${persona.id}` : tag));
      spec.channel = channel;
      const cell = (spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell;
      if (cell) Object.assign(cell, { user_type: persona.id, channel });
    }
    return { ...cover, spec };
  };
  const mini: Generation = {
    ...generated,
    complete: [...speaking, cover, copy('gen-cover-004-twin', false), copy('gen-cover-004-relabelled', true)],
  };
  const classes = FAULT_CLASSES.filter((cls) => cls.id === 'X1.case');
  const runs = await runAll(mini, { faults: (spec) => faultFamily(spec, classes), cheaters: [], k: 1 });
  const blocks = runs.blocks.filter((block) => block.fields.length > 0);
  const of = (id: string) => blocks.filter((block) => block.spec === id);

  it('keeps apart two blocks only a fault bound to one persona tells apart', () => {
    expect(speaking.length).toBeGreaterThan(1);
    const split = blocks.filter((a) =>
      blocks.some(
        (b) =>
          a.spec !== b.spec &&
          speaking.some(({ spec }) => spec.id === a.spec) &&
          a.cell.user_type !== b.cell.user_type &&
          plainVector(a) === plainVector(b) &&
          vectorOf(a) !== vectorOf(b),
      ),
    );
    expect(split.length).toBeGreaterThan(0);
  });

  it('still calls a spec emitted twice redundant, block by block', () => {
    const twin = of('gen-cover-004-twin');
    expect(twin.length).toBeGreaterThan(0);
    of(cover.spec.id).forEach((block, index) => {
      expect(vectorOf(required(twin[index]))).toBe(vectorOf(block));
    });
  });

  it('still calls a copy redundant when only its persona tag and channel change, which no agent receives', () => {
    const relabelled = of('gen-cover-004-relabelled');
    expect(relabelled.length).toBeGreaterThan(0);
    of(cover.spec.id).forEach((block, index) => {
      const other = required(relabelled[index]);
      expect(other.cell).not.toEqual(block.cell);
      expect(vectorOf(other)).toBe(vectorOf(block));
    });
  });

  it('gives a persona-bound fault the reference outcome on a spec where no persona is said', () => {
    for (const block of of(cover.spec.id))
      for (const outcome of Object.values(block.contextFaults)) expect(outcome).toBe(block.reference[0]);
  });
}, 600_000);
