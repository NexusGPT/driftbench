import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, plannerItems, SeedData } from '../../src/ladders/generator';

// Each call of the planner runs in three processes under the frame, so a seed takes minutes.
vi.setConfig({ testTimeout: 1_800_000 });

/**
 * The catch items of the planner family (docs/validators.md section 12.4): each passes on the planner on seeds 1 to 3,
 * each is lost to the planted bug it guards on those seeds, and each is pinned in validators/generator/catch.json.
 */
const CATCH = [
  ['search-valid-covering', 'drops-last-row'],
  ['zero-total-weights-refused', 'zero-weights-accepted'],
  ['rendered-budget', 'render-drops-budget'],
  ['unreachable-required-flag', 'unreachable-never-required'],
  ['rules-from-passages', 'rules-drop-last-variable'],
] as const;

const data = (seed: number) =>
  new SeedData(seed, {}, async () => {
    throw new Error('no scale run');
  });

const catchItems = (module?: string) => plannerItems(module).filter((item) => item.role === 'catch');

describe('the catch items of the planner family', () => {
  it('pins exactly the catch items in validators/generator/catch.json, each with what it guards', () => {
    const file = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../../validators/generator/catch.json', import.meta.url)),
        'utf8',
      ),
    ) as { items: Array<{ id: string; guards: string }> };
    expect(file.items.map((entry) => entry.id).sort()).toEqual(
      catchItems()
        .map((item) => item.id)
        .sort(),
    );
    expect(
      catchItems()
        .map((item) => item.id)
        .sort(),
    ).toEqual(CATCH.map(([id]) => `planner.catch.${id}`).sort());
  });

  it('passes every catch item on the planner, seeds 1 to 3', async () => {
    for (const seed of [1, 2, 3])
      for (const { item, verdict } of await evaluate(catchItems(), data(seed)))
        expect(verdict.pass, `${item.id} seed ${seed}: ${verdict.detail}`).toBe(true);
  });

  it.each(CATCH)('loses %s to the planted bug %s on seeds 1 to 3', async (id, bug) => {
    const module = fileURLToPath(new URL(`./fixtures/planner-mutants/${bug}.ts`, import.meta.url));
    const items = catchItems(module).filter((item) => item.id === `planner.catch.${id}`);
    expect(items).toHaveLength(1);
    for (const seed of [1, 2, 3]) {
      const [result] = await evaluate(items, data(seed));
      expect(result?.verdict.pass, `seed ${seed}`).toBe(false);
      expect(result?.verdict.detail ?? '').not.toMatch(/the item threw|did not load/);
    }
  });
});
