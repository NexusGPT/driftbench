import { describe, expect, it } from 'vitest';
import { bankItems, outsideTwinPairs, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import type { HiddenSpec } from '../../src/ladders/generator/hidden';
import { type BlockRun, type Generation, runAll } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * A declared perturbation exists to measure sensitivity to its axis, so the suite keeps one twin pair per path and
 * per declared axis; a second pair on the same axis, or a copy on a channel or persona the map does not declare, is
 * a repeat (docs/validators.md, section 3, Same test).
 */
describe('minimality accepts one twin pair per path and declared axis', async () => {
  const generated = await new SeedData(1, {}, async () => ({}) as never).generated();
  const cover = required(generated.complete.find(({ spec }) => spec.id === 'gen-cover-004'));
  const channels = generated.hidden.channels.filter((entry) => entry !== cover.spec.channel);
  const personas = generated.hidden.personas.filter(
    (entry) => !cover.spec.tags?.includes(`persona:${entry.id}`),
  );
  const copy = (id: string, channel: string, persona?: string) => {
    const spec = structuredClone(cover.spec);
    spec.id = id;
    spec.channel = channel;
    if (persona !== undefined)
      spec.tags = spec.tags?.map((tag) => (tag.startsWith('persona:') ? `persona:${persona}` : tag));
    return { ...cover, spec };
  };
  const classes = FAULT_CLASSES.filter((cls) => cls.id === 'X1.case');
  const options = { faults: (hidden: HiddenSpec) => faultFamily(hidden, classes), cheaters: [], k: 1 };
  const verdictOf = async (complete: Generation['complete']) => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    await data.memoized('runs', async () => runAll(mini, options));
    return required(bankItems().find((entry) => entry.id === 'minimal.X1.case')).check(data);
  };
  const flagged = (detail: string) => /[1-9]\d* groups contain a removable duplicate/.test(detail);

  // The groups of the last blocks of the given specs, evaluated against one suite.
  const outsideOf = async (
    complete: Generation['complete'],
    groups: string[][],
  ): Promise<string[][]> => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    const runs = await runAll(mini, options);
    await data.memoized('runs', async () => runs);
    const lastOf = (id: string): BlockRun =>
      required(runs.blocks.filter((block) => block.spec === id && block.fields.length > 0).at(-1));
    const result: string[][] = [];
    for (const ids of groups)
      result.push((await outsideTwinPairs(data, ids.map(lastOf))).map((block) => block.spec));
    return result;
  };

  it('has the declared channels and personas it needs', () => {
    expect(channels.length).toBeGreaterThan(0);
    expect(personas.length).toBeGreaterThan(0);
  });

  // The group of the last blocks of the copies, in the order the suite writes them.
  const outside = async (complete: Generation['complete']): Promise<string[]> => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    const runs = await runAll(mini, options);
    await data.memoized('runs', async () => runs);
    const lastOf = (id: string): BlockRun =>
      required(runs.blocks.filter((block) => block.spec === id && block.fields.length > 0).at(-1));
    const group = complete.map(({ spec }) => lastOf(spec.id));
    return (await outsideTwinPairs(data, group)).map((block) => block.spec);
  };

  it('accepts the written walk and one twin on another declared channel', async () => {
    expect(await outside([cover, copy('twin-channel', required(channels[0]))])).toEqual([]);
  }, 600_000);

  it('accepts one twin per declared axis: a channel twin and a persona twin', async () => {
    expect(
      await outside([
        cover,
        copy('twin-channel', required(channels[0])),
        copy('twin-persona', cover.spec.channel as string, required(personas[0]).id),
      ]),
    ).toEqual([]);
  }, 600_000);

  it('counts a second pair on the same axis, an undeclared copy and a same-context copy as repeats', async () => {
    expect(
      await outside([
        cover,
        copy('twin-channel', required(channels[0])),
        copy('twin-channel-again', required(channels[0])),
        copy('twin-undeclared', 'a-channel-nobody-declared'),
        copy('twin-same', cover.spec.channel as string),
      ]),
    ).toEqual(['twin-channel-again', 'twin-undeclared', 'twin-same']);
  }, 600_000);

  it('keeps one twin pair per path over the whole suite, not one per group', async () => {
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
    const [one, two] = await outsideOf(
      [cover, copy('twin', required(channels[0])), otherWalk, otherTwin],
      [
        [cover.spec.id, 'twin'],
        ['other-walk', 'other-twin'],
      ],
    );
    // The first group keeps the channel pair of the path; a second walk of the same path gets none.
    expect(one).toEqual([]);
    expect(two).toEqual(['other-twin']);
  }, 600_000);

  it('always counts a copy on an undeclared channel as a repeat, whatever else differs', async () => {
    const odd = copy('odd', 'a-channel-nobody-declared', required(personas[0]).id);
    const witness = copy('witness', cover.spec.channel as string, required(personas[0]).id);
    const [group] = await outsideOf([cover, witness, odd], [[cover.spec.id, 'witness', 'odd']]);
    // The persona twin is kept; the copy on the undeclared channel is a repeat although its persona differs.
    expect(group).toEqual(['odd']);
  }, 600_000);

  it('still fails a suite that keeps a second pair on the same axis (planted reducer)', async () => {
    const found = await verdictOf([
      cover,
      copy('twin-channel', required(channels[0])),
      copy('twin-channel-again', required(channels[0])),
    ]);
    expect(flagged(found.detail), found.detail).toBe(true);
  }, 600_000);

  it('still fails a suite that keeps a copy on a channel the map does not declare (planted reducer)', async () => {
    const found = await verdictOf([cover, copy('twin-undeclared', 'a-channel-nobody-declared')]);
    expect(flagged(found.detail), found.detail).toBe(true);
  }, 600_000);

  it('still fails a suite that keeps a copy with the same channel and persona (planted reducer)', async () => {
    const found = await verdictOf([cover, copy('twin-same', cover.spec.channel as string)]);
    expect(flagged(found.detail), found.detail).toBe(true);
  }, 600_000);
}, 600_000);
