import { type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { SeedData } from '../../src/ladders/generator/bank';
import { researchItems } from '../../src/ladders/generator/bank2';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import type { Generation } from '../../src/ladders/generator/measure';
import { pathChannels } from '../../src/ladders/generator/possible';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

/**
 * The channel invariance item asks for a copy of a path on a second channel only where an allowed full cell holds the
 * path on it (possible.ts, the rule of constrained combinatorial testing, NIST SP 800-142). On the hidden map of seed 14
 * the flow `new-request` lists only B-003 and B-004, which are web-only, so its path has no messaging copy.
 */
describe('the channel invariance item requires a second channel only where one is possible', () => {
  const hidden = hiddenSpec(14);

  /** A complete spec that walks a base path on a channel: the item reads its title and channel. */
  function walk(path: string, channel: string, persona: string): LoadedSpec {
    const spec = Spec.parse({
      id: `walk-${path}-${channel}-${persona}`,
      title: `Path ${path} of the flow: walk`,
      kind: 'conversation',
      channel,
      tags: [`persona:${persona}`],
      blocks: [{ when: { user: 'Hello.' }, expect: { stage: 'intake' } }],
    });
    return { ok: true, path: `complete/${spec.id}.yaml`, spec, hash: '', warnings: [] };
  }

  async function verdictOf(id: string, complete: LoadedSpec[] = []) {
    const generated: Generation = {
      hidden,
      generatorSeed: 14,
      first: new Map(),
      second: new Map(),
      loaded: complete,
      complete,
    };
    const data = new SeedData(14, {}, async () => ({}) as never);
    vi.spyOn(data, 'generated').mockResolvedValue(generated);
    return required(researchItems().find((entry) => entry.id === id)).check(data);
  }

  it('reads the channels of the paths of seed 14', () => {
    expect(pathChannels(hidden, 'new-request-full')).toEqual(['web']);
    expect(pathChannels(hidden, 'status-check-lookup')).toEqual(['web', 'messaging']);
    expect(pathChannels(hidden, 'change-request-back')).toEqual(['web', 'messaging']);
    expect(pathChannels(hidden, 'no-such-path')).toEqual([]);
  });

  it('asks for no messaging copy of new-request-full', async () => {
    const found = await verdictOf('invariance.new-request-full.channel');
    expect(found.pass, found.detail).toBe(true);
    expect(found.detail).toMatch(/runs on 1 channel \(web\)/);
  });

  it('still asks for a second channel where the path runs on two', async () => {
    for (const path of ['status-check-lookup', 'change-request-back']) {
      const found = await verdictOf(`invariance.${path}.channel`);
      expect(found.pass, found.detail).toBe(false);
      expect(found.detail).toMatch(/no two complete specs walk the path/);
    }
  });

  it('asks no walk on a channel the path cannot run on (paths.<id>.channels)', async () => {
    const found = await verdictOf('paths.new-request-full.channels');
    // No complete spec at all: the item fails on "no spec", but names no channel it cannot run on.
    expect(found.detail).toBe('channels never walked on the path: web');
    const other = await verdictOf('paths.status-check-lookup.channels');
    expect(other.detail).toBe('channels never walked on the path: web, messaging');
  });

  it('fails a path missing a channel its flow allows; passes once every possible one is walked', async () => {
    const persona = required(hidden.personas[0]).id;
    // new-request-full runs on web only: a web walk satisfies the item, with no messaging walk.
    const only = [walk('new-request-full', 'web', persona)];
    const web = await verdictOf('paths.new-request-full.channels', only);
    expect(web.pass, web.detail).toBe(true);
    // status-check-lookup runs on both: a web walk alone leaves messaging missing.
    const half = await verdictOf('paths.status-check-lookup.channels', [
      walk('status-check-lookup', 'web', persona),
    ]);
    expect(half.pass).toBe(false);
    expect(half.detail).toBe('channels never walked on the path: messaging');
    const both = await verdictOf('paths.status-check-lookup.channels', [
      walk('status-check-lookup', 'web', persona),
      walk('status-check-lookup', 'messaging', persona),
    ]);
    expect(both.pass, both.detail).toBe(true);
  });
});
