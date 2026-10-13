import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as cacheKeys from '../../src/runner/cache';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, memoryCache, minimalChecks, specOf } from './support';

afterEach(() => vi.restoreAllMocks());

const spec = specOf({
  id: 'cache-key-work',
  blocks: ['first', 'second', 'third'].map((user) => ({
    user,
    expect: { must: ['ok'] },
  })),
});

describe('cache work in runner modes', () => {
  it.each(['F', 'T'] as const)('does not build unused block keys in an uncached %s run', async (mode) => {
    const keys = vi.spyOn(cacheKeys, 'blockCacheKey');
    keys.mockClear();
    const run = await runSpec(spec, {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: minimalChecks,
      mode,
      repeat: 0,
    });
    expect(run.status, run.error).toBe('completed');
    expect(run.blocks.map((block) => [block.observed.text, block.pass])).toEqual([
      ['ok', true],
      ['ok', true],
      ['ok', true],
    ]);
    expect(keys).not.toHaveBeenCalled();
  });

  it('retains block identity for a cached live run and its replay', async () => {
    const keys = vi.spyOn(cacheKeys, 'blockCacheKey');
    keys.mockClear();
    const cache = memoryCache();
    const options = {
      adapter: echoAdapter(),
      driver: createScriptedDriver(),
      checks: minimalChecks,
      repeat: 0,
      cache,
    };
    const live = await runSpec(spec, { ...options, mode: 'F' });
    const liveKeys = [...cache.entries.keys()];
    keys.mockClear();
    const replay = await runSpec(spec, { ...options, mode: 'P' });
    expect(liveKeys).toHaveLength(3);
    expect(keys.mock.results.map((result) => result.value)).toEqual(liveKeys);
    expect(replay.status, replay.error).toBe('completed');
    expect(replay.cacheHit).toBe(true);
    expect(replay.blocks.map((block) => [block.observed.text, block.pass])).toEqual(
      live.blocks.map((block) => [block.observed.text, block.pass]),
    );
  });
});
