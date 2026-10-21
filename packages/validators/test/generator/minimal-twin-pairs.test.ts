import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { type Generation, runAll } from '../../src/ladders/generator/measure';

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
  const options = { faults: (spec: typeof cover.spec) => faultFamily(spec, classes), cheaters: [], k: 1 };
  const verdictOf = async (complete: Generation['complete']) => {
    const mini: Generation = { ...generated, complete };
    const data = new SeedData(1, options, async () => ({}) as never);
    await data.memoized('generated', async () => mini);
    await data.memoized('runs', async () => runAll(mini, options));
    return required(bankItems().find((entry) => entry.id === 'minimal.X1.case')).check(data);
  };
  const flagged = (detail: string) => /[1-9]\d* groups contain a removable duplicate/.test(detail);

  it('has the declared channels and personas it needs', () => {
    expect(channels.length).toBeGreaterThan(0);
    expect(personas.length).toBeGreaterThan(0);
  });

  it('accepts the written walk and one twin on another declared channel', async () => {
    const found = await verdictOf([cover, copy('twin-channel', required(channels[0]))]);
    expect(flagged(found.detail), found.detail).toBe(false);
  }, 600_000);

  it('accepts one twin per declared axis: a channel twin and a persona twin', async () => {
    const found = await verdictOf([
      cover,
      copy('twin-channel', required(channels[0])),
      copy('twin-persona', cover.spec.channel as string, required(personas[0]).id),
    ]);
    expect(flagged(found.detail), found.detail).toBe(false);
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
