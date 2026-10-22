import { describe, expect, it, vi } from 'vitest';
import { removeBlock, SeedData } from '../../src/ladders/generator/bank';
import {
  ALLOCATION_BOUNDS,
  ALLOCATION_DIMENSIONS,
  allocationLost,
  balanceOf,
  balancePasses,
  researchItems,
} from '../../src/ladders/generator/bank2';
import type { Generation } from '../../src/ladders/generator/measure';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

const MEASURE_ITEM = { pielou: 'evenness', hill1: 'hill1', ratio: 'ratio' } as const;

/**
 * A duplicate whose removal makes the suite fail an allocation item it passes is allocation work, not a repeat
 * (docs/validators.md, section 3, Same test). The allocation items judge Pielou evenness, the Hill number of order 1
 * and the most/least placed ratio per dimension; `allocationLost` names the ones a removal costs.
 */
describe('minimality keeps a block whose removal costs an allocation item', async () => {
  const base = await new SeedData(1, {}, async () => ({}) as never).generated();

  /** The allocation items that pass on a suite, read from the real items, not from allocationLost. */
  const passing = async (generated: Generation): Promise<Set<string>> => {
    const data = new SeedData(1, {}, async () => ({}) as never);
    vi.spyOn(data, 'generated').mockResolvedValue(generated);
    const out = new Set<string>();
    for (const dimension of ALLOCATION_DIMENSIONS)
      for (const measure of ['pielou', 'hill1', 'ratio'] as const) {
        const item = required(
          researchItems().find((entry) => entry.id === `allocation.${dimension}.${MEASURE_ITEM[measure]}`),
        );
        if ((await item.check(data)).pass) out.add(`${dimension}.${measure}`);
      }
    return out;
  };
  const without = (generated: Generation, spec: number, block: number): Generation => {
    const target = required(generated.complete[spec]);
    const reduced = { ...target, spec: removeBlock(target.spec, block) };
    const complete = generated.complete.map((entry, index) => (index === spec ? reduced : entry));
    return { ...generated, complete, loaded: complete };
  };

  it('uses the thresholds of the allocation items', () => {
    expect(ALLOCATION_BOUNDS).toEqual({ pielou: 0.9, hill1: 0.8, ratio: 3 });
    expect(balancePasses([5, 5, 5])).toEqual({ pielou: true, hill1: true, ratio: true });
    expect(balancePasses([6, 2, 2]).ratio).toBe(true);
    expect(balancePasses([7, 2, 2]).ratio).toBe(false);
    expect(balancePasses([5, 5, 0]).ratio).toBe(false);
    expect(balancePasses([20, 1, 1]).pielou).toBe(false);
    expect(balancePasses([20, 1, 1]).hill1).toBe(false);
    expect(balanceOf([4, 4]).pielou).toBeCloseTo(1, 12);
    expect(balanceOf([4, 4]).hill1).toBeCloseTo(2, 12);
    expect(balanceOf([6, 3]).ratio).toBe(2);
  });

  it('loses nothing when nothing is removed, and everything it passes when everything is', async () => {
    expect(allocationLost(base, base)).toEqual([]);
    const empty: Generation = { ...base, complete: [], loaded: [] };
    const before = await passing(base);
    const lost = allocationLost(base, empty);
    // An item the suite passes is lost on an empty suite unless the empty suite passes it too.
    const still = await passing(empty);
    expect(new Set(lost)).toEqual(new Set([...before].filter((id) => !still.has(id))));
  }, 600_000);

  it('agrees with the real allocation items on every single-block removal it is asked about', async () => {
    const before = await passing(base);
    let checked = 0;
    for (const [spec, entry] of base.complete.entries()) {
      for (const block of entry.spec.blocks.keys()) {
        if (checked >= 30) break;
        checked += 1;
        const reduced = without(base, spec, block);
        const after = await passing(reduced);
        const expected = [...before].filter((id) => !after.has(id)).sort();
        expect(allocationLost(base, reduced).sort(), `${entry.spec.id} block ${block}`).toEqual(expected);
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 600_000);
}, 600_000);
