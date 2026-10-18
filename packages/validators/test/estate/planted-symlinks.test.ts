import { lstat, readlink, realpath, symlink } from 'node:fs/promises';
import { basename, dirname, relative } from 'node:path';
import { expect, it, vi } from 'vitest';
import { PlantedEstate } from '../../src/ladders/estate/bank/planted';
import { symlinkFamily } from '../../src/ladders/estate/bank/scan-links';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, symlink: vi.fn(fs.symlink) };
});

it.each([1, 2, 3])(
  'plants every scan.symlink fixture with Linux symlink semantics on seed %i',
  async (seed) => {
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const declared = vi.spyOn(PlantedEstate.prototype, 'link');
    const plant = vi.mocked(symlink);
    plant.mockClear();
    let loops = 0;
    plant.mockImplementation(async (target, at, type) => {
      // Linux rejects an empty target; emulate that even on hosts that accept it.
      if (target === '') throw Object.assign(new Error('empty symlink target'), { code: 'ENOENT' });
      await fs.symlink(target, at, type);
      expect((await lstat(at)).isSymbolicLink()).toBe(true);
      expect(await readlink(at)).toBe(target);
      if (typeof at === 'string' && basename(at) === 'again') {
        const parent = dirname(at);
        expect(relative(parent, parent)).toBe('');
        expect(target).toBe('.');
        expect(await realpath(at)).toBe(await realpath(parent));
        loops += 1;
      }
    });
    try {
      const family = symlinkFamily();
      const results = await family.evaluate(seed);
      expect(family.items).toHaveLength(23);
      expect([...results.keys()].sort()).toEqual(family.items.map((item) => item.id).sort());
      expect(plant).toHaveBeenCalledTimes(declared.mock.calls.length);
      expect(loops).toBe(1);
      // Product verdicts belong to the validator; this test checks fixture construction.
    } finally {
      declared.mockRestore();
      plant.mockImplementation(fs.symlink);
    }
  },
  60_000,
);
