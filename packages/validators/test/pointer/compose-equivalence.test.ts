import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { reachedNames } from './fingerprint';
import { heavy, REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference/index';

/**
 * The provenance fingerprint leaves `compose`, `written` and `truthOf` out, because the change to `compose` after the
 * blind commit only records the units it wrote. This test is the proof: every item that reaches `compose` runs
 * once with `compose` as it was at the blind commit (the fixture, a copy of that file) and once with today's, and
 * the verdicts and the details are the same.
 */
const state = vi.hoisted(() => ({ blind: false }));

vi.mock('../../src/ladders/pointer/kit/compose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/pointer/kit/compose')>();
  const blind = await import('./fixtures/compose-blind');
  return {
    ...actual,
    compose: (...args: Parameters<typeof actual.compose>) => (state.blind ? blind : actual).compose(...args),
  };
});

const root = fileURLToPath(new URL('../../src/ladders/pointer', import.meta.url));

describe('compose as it was at the blind commit gives the same verdicts and details as today', {
  timeout: 900_000,
}, () => {
  it('for every item that reaches compose', async () => {
    const ids = new Set(
      pointerBank()
        .filter((item) => reachedNames(root, item.id).includes('compose') && !heavy(item))
        .map((item) => item.id),
    );
    expect(ids.size).toBeGreaterThan(200);
    const run = async (blind: boolean) => {
      state.blind = blind;
      const before = process.env.DRIFTBENCH_POINTER_SUT;
      process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
      clearSeedFreeCache();
      try {
        const out: Record<string, { pass: boolean; detail: string }> = {};
        for (const item of pointerBank().filter((i) => ids.has(i.id)))
          out[item.id] = await runItem(item, 1, referenceSut());
        return out;
      } finally {
        if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
        else process.env.DRIFTBENCH_POINTER_SUT = before;
      }
    };
    const today = await run(false);
    const blindCompose = await run(true);
    expect(Object.keys(today)).toHaveLength(ids.size);
    expect(blindCompose).toEqual(today);
  });

  it('the old compose is the blind commit file: it has no truthOf', async () => {
    const blind = await import('./fixtures/compose-blind');
    expect('truthOf' in blind).toBe(false);
  });
});
