import { describe, expect, it } from 'vitest';
import { catalogueFamily } from '../../src/ladders/estate/bank/scan-guards';
import { registryFamily } from '../../src/ladders/estate/bank/scan-registry';

/**
 * The registry-roles questions of the scan are answered, in the bank, from what the planter recorded: the role of
 * each column of the header line it wrote, and the state value it wrote as off. These items hold only if the
 * scan asked per table, by position, and the off state came back as an off state.
 */
describe('the bank plants registry tables with recorded roles', () => {
  it('reads every planted registry table through its recorded column roles', async () => {
    const family = registryFamily();
    const results = await family.evaluate(1);
    const failed = [...results]
      .filter(([, result]) => !result.pass)
      .map(([id, result]) => `${id}: ${result.detail}`);
    expect(failed).toEqual([]);
  }, 120_000);

  it('keeps a check in an off state from enforcing, and one that is on enforcing', async () => {
    const family = catalogueFamily();
    const results = await family.evaluate(1);
    const off = results.get('scan.catalogue.off-state');
    expect(off, 'the off-state item exists').toBeDefined();
    expect(off?.detail).toBe('holds');
    expect(off?.pass).toBe(true);
    const failed = [...results]
      .filter(([, result]) => !result.pass)
      .map(([id, result]) => `${id}: ${result.detail}`);
    expect(failed).toEqual([]);
  }, 120_000);

  it('has an item for each role, and each holds', async () => {
    const family = registryFamily();
    const results = await family.evaluate(1);
    expect([...results.keys()].filter((id) => id.includes('.role-')).sort()).toEqual(
      ['description', 'enforces', 'event', 'guard', 'id', 'state', 'verdict', 'watches'].map(
        (role) => `scan.registry.role-${role}`,
      ),
    );
    const failed = [...results]
      .filter(([, result]) => !result.pass)
      .map(([id, result]) => `${id}: ${result.detail}`);
    expect(failed).toEqual([]);
  }, 120_000);
});
