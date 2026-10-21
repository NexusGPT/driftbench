import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import type { HiddenSpec } from '../../src/ladders/generator/hidden';
import { type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * Four suites an independent reviewer planted against the twin-pair exemption (PR 1083, validators-review-root): each
 * keeps a removable copy of gen-cover-004 that the actual `minimal.X1.case` item must flag.
 */
describe('planted suites that keep a removable copy are flagged by the actual item', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const channel = required(generated.hidden.channels.find((entry) => entry !== cover.spec.channel));
  const persona = required(
    generated.hidden.personas.find((entry) => !cover.spec.tags?.includes(`persona:${entry.id}`)),
  );
  const classes = FAULT_CLASSES.filter((cls) => cls.id === 'X1.case');
  const options = { faults: (hidden: HiddenSpec) => faultFamily(hidden, classes), cheaters: [], k: 1 };
  const copy = (
    id: string,
    change: { world?: boolean; channel?: string | null; persona?: boolean | null } = {},
  ) => {
    const entry = structuredClone(cover);
    entry.spec.id = id;
    if (change.channel === null) delete entry.spec.channel;
    else if (change.channel !== undefined) entry.spec.channel = change.channel;
    if (change.persona === null) entry.spec.tags = entry.spec.tags?.filter((tag) => !tag.startsWith('persona:'));
    else if (change.persona)
      entry.spec.tags = entry.spec.tags?.map((tag) =>
        tag.startsWith('persona:') ? `persona:${persona.id}` : tag,
      );
    if (change.world) {
      const answer = entry.spec.given?.world?.tools?.lookup_record;
      if (!answer) throw new Error('missing lookup fixture');
      entry.spec.given = {
        ...entry.spec.given,
        world: { tools: { lookup_record: { result: { ...(answer.result as object), reviewExtra: 'other' } } } },
      };
    }
    return entry;
  };
  const verdict = async (complete: Generation['complete']) => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    const runs = await runAll(mini, options);
    await data.memoized('runs', async () => runs);
    expect(runs.errors).toEqual([]);
    return required(bankItems().find((entry) => entry.id === 'minimal.X1.case')).check(data);
  };

  it('a second removable channel pair on the same path, in another tool-answer group', async () => {
    const found = await verdict([
      copy('review-A'),
      copy('review-A-channel', { channel }),
      copy('review-B', { world: true }),
      copy('review-B-channel', { world: true, channel }),
    ]);
    expect(found.pass, found.detail).toBe(false);
  }, 600_000);

  it('a copy on an undeclared channel even when its persona is declared and a witness exists', async () => {
    const found = await verdict([
      copy('review-base'),
      copy('review-undeclared-channel', { channel: 'review-undeclared', persona: true }),
      copy('review-persona-witness', { world: true, persona: true }),
    ]);
    expect(found.pass, found.detail).toBe(false);
  }, 600_000);

  it('a copy whose channel is missing: an absent value is no declared value of the axis', async () => {
    const found = await verdict([copy('review-complete-context'), copy('review-missing-channel', { channel: null })]);
    expect(found.pass, found.detail).toBe(false);
  }, 600_000);

  it('a copy whose persona is missing: an absent value is no declared value of the axis', async () => {
    const found = await verdict([copy('review-complete-context'), copy('review-missing-persona', { persona: null })]);
    expect(found.pass, found.detail).toBe(false);
  }, 600_000);
}, 600_000);
