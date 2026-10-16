import * as fs from 'node:fs/promises';
import * as product from '@agent-nexus/driftbench-estate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plantSkill } from '../../src/ladders/estate/bank/common';
import { type Case, hostileFamily, judgeCase } from '../../src/ladders/estate/bank/hostile';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock('@agent-nexus/driftbench-estate', async (original) => ({
  ...(await original<typeof import('@agent-nexus/driftbench-estate')>()),
  scanEstate: vi.fn(),
  lintEstate: vi.fn(),
}));

// A handwritten estate, independent of the bank's cases, names and seeds.
const handwritten: Case = {
  key: 'handwritten-timing',
  tier: 1,
  title: 'a small parcel audit skill',
  plant(estate, _seed, owner) {
    plantSkill(estate, owner, 'parcel-audit', 'Audit parcel records.', []);
  },
};

describe('scan wall-clock budgets measure only the product scan', () => {
  let clock: number;
  let writeMs: number;
  let scanMs: number;
  let lintMs: number;
  let cleanupMs: number;

  beforeEach(async () => {
    clock = 0;
    writeMs = 0;
    scanMs = 0;
    lintMs = 0;
    cleanupMs = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const actualFs = await vi.importActual<typeof fs>('node:fs/promises');
    const actualProduct = await vi.importActual<typeof product>('@agent-nexus/driftbench-estate');
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      await actualFs.writeFile(...args);
      clock += writeMs;
    });
    vi.mocked(fs.rm).mockImplementation(async (...args) => {
      await actualFs.rm(...args);
      clock += cleanupMs;
    });
    vi.mocked(product.scanEstate).mockImplementation(async (...args) => {
      expect(fs.writeFile).toHaveBeenCalled();
      const result = await actualProduct.scanEstate(...args);
      // A deliberately slow scanner double, using a controlled clock instead of sleeping.
      clock += scanMs;
      return result;
    });
    vi.mocked(product.lintEstate).mockImplementation((...args) => {
      const result = actualProduct.lintEstate(...args);
      clock += lintMs;
      return result;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each(['scan.hostile', 'scan.decoys'])('excludes fixture writes for %s', async (family) => {
    writeMs = 6000;
    scanMs = 700;
    expect(await judgeCase(17, family, handwritten)).toEqual({ pass: true, detail: 'holds' });
    expect(clock).toBeGreaterThan(5000);
    expect(product.scanEstate).toHaveBeenCalledTimes(1);
  });

  it('excludes validator lint and fixture cleanup', async () => {
    scanMs = 900;
    lintMs = 6000;
    cleanupMs = 6000;
    expect(await judgeCase(17, 'scan.hostile', handwritten)).toEqual({ pass: true, detail: 'holds' });
    expect(product.lintEstate).toHaveBeenCalledTimes(1);
    expect(fs.rm).toHaveBeenCalledTimes(1);
  });

  it.each([4999, 5000, 5001])('preserves the 5000 ms boundary for a %i ms scanner', async (ms) => {
    scanMs = ms;
    const result = await judgeCase(17, 'scan.hostile', handwritten);
    expect(result.pass).toBe(ms <= 5000);
    if (ms > 5000) expect(result.detail).toContain('the scan took 5001 ms, over 5000 ms');
  });

  it('the wide-folder item still rejects a deliberately slow scanner', async () => {
    scanMs = 5001;
    const result = (await hostileFamily().evaluate(17)).get('scan.hostile.wide-folder');
    expect(result).toEqual({
      pass: false,
      detail: 'the scan took 5001 ms, over 5000 ms; holds',
    });
  }, 30_000);

  it('still rejects wrong scan output within budget', async () => {
    vi.mocked(product.scanEstate).mockImplementationOnce(async (...args) => {
      const actual = await vi.importActual<typeof product>('@agent-nexus/driftbench-estate');
      const result = await actual.scanEstate(...args);
      return { ...result, map: { ...result.map, atoms: [], edges: [] } };
    });
    const result = await judgeCase(17, 'scan.hostile', handwritten);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('missed skill parcel-audit');
  });

  it('still rejects a scanner that throws', async () => {
    vi.mocked(product.scanEstate).mockRejectedValueOnce(new Error('scanner broke'));
    expect(await judgeCase(17, 'scan.hostile', handwritten)).toEqual({
      pass: false,
      detail: 'the scan threw: scanner broke',
    });
    expect(fs.rm).toHaveBeenCalledTimes(1);
  });
});
