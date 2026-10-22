import { describe, expect, it } from 'vitest';
import { LEVELS, runInProcess, variablesBank } from '../../src/ladders/variables/bank/index';
import { lockedRun, variablesLadder } from '../../src/ladders/variables/index';
import { referenceImpl } from '../variables-blind/reference/index';

const ROOT = new URL('../../../../', import.meta.url).pathname;

describe('a level opens only when every level before it passes', () => {
  const items = variablesBank().filter((i) => i.tier === 1);

  it('splits the store into a core and its readers, both with items', () => {
    expect(LEVELS.slice(0, 2)).toEqual(['store-core', 'store-readers']);
    for (const level of LEVELS.slice(0, 2)) expect(items.some((i) => i.level === level), level).toBe(true);
  });

  it('counts the items of a locked level as failing, and says which level locks them', async () => {
    // Every item passes except one of the core: the levels after it are locked, though their items would pass.
    const run = await runInProcess(items, 1, ROOT, referenceImpl);
    const core = items.find((i) => i.level === 'store-core');
    expect(core).toBeDefined();
    run.set((core as { id: string }).id, { pass: false, detail: 'planted failure' });
    for (const level of LEVELS.slice(1)) {
      const locked = lockedRun(items, run, level);
      const own = items.filter((i) => i.level === level);
      expect(own.length, level).toBeGreaterThan(0);
      for (const item of own) {
        const outcome = locked.get(item.id);
        expect(outcome?.pass, item.id).toBe(false);
        expect(outcome?.detail, item.id).toMatch(/^locked: level store-core still has 1 failing item/);
      }
    }
    // The first level is never locked.
    expect(lockedRun(items, run, 'store-core')).toBe(run);
  });

  it('the failing count of the ladder includes the locked items', async () => {
    const ladder = variablesLadder({
      impl: {
        ...referenceImpl,
        // The planted failure: the loader refuses everything, so items of the core fail and every later level locks.
        validate: () => ({ ok: false, errors: [{ code: 'PLANTED', path: '' }] }),
      },
      filter: (item) => item.tier === 1,
    });
    const { runLadder } = await import('../../src/ladder');
    const run = await runLadder(ladder, { seed: 1, root: ROOT, full: true });
    const core = run.rows.find((r) => r.id === 'store-core');
    expect(core?.bank?.some((b) => !b.pass)).toBe(true);
    const later = run.rows.filter((r) => r.level > 1 && r.bank);
    expect(later.length).toBe(LEVELS.length - 1);
    for (const row of later) {
      expect(row.bank?.length, row.id).toBeGreaterThan(0);
      expect(row.bank?.every((b) => !b.pass), row.id).toBe(true);
      expect(row.observed, row.id).toBe(0);
    }
  });
});
