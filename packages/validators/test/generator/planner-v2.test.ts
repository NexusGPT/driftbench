import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, plannerItems, SeedData } from '../../src/ladders/generator';

// Each call of the planner runs in three processes under the frame, so a seed takes minutes.
vi.setConfig({ testTimeout: 1_800_000 });

const MUTANTS = [
  ['drops-last-row', 'planner.own-rule-tuples'],
  ['ignores-seeds', 'planner.seeds-lead'],
  ['ignores-seeds', 'planner.seeds-reduce-new-rows.mostly'],
  ['ignores-seeds', 'planner.seeds-reduce-new-rows.30'],
  ['ignores-budget', 'planner.budget-prefix'],
  ['reverses-order', 'planner.rarest-cut-first'],
  ['cuts-seeds', 'planner.budget-keeps-seeds'],
  ['forbidden-row', 'planner.no-forbidden-row'],
  ['flat-weights', 'planner.traffic-weight-of-a-row'],
  ['nan-weights', 'planner.traffic-weight-of-a-row'],
  ['infinity-weights', 'planner.traffic-weight-of-a-row'],
  ['no-layers-uncut', 'planner.layers-agree'],
  ['zero-shared-single', 'planner.layers-agree'],
  ['omitted-budget-is-zero', 'planner.layers-agree'],
  ['zero-seeded', 'planner.layers-with-seeds'],
  ['blank-header', 'planner.report-header'],
  ['no-warnings', 'planner.hostile.unreachable-value-warned'],
  ['empty-row-id', 'planner.ids-in-order'],
  ['seeds-missing', 'planner.seeds-lead'],
  ['drops-odd-seed', 'planner.hostile.unknown-seed-value-kept'],
  ['stale-cut-count', 'planner.budget-cut-count'],
  ['pairs-only', 'planner.own-rule-tuples'],
] as const;

/** A lost item counts as caught only when a check failed: a load error or a throw is no verdict. */
const caught = (out: Awaited<ReturnType<typeof run>>) =>
  out
    .filter((entry) => !entry.verdict.pass)
    .filter((entry) => !/the item threw|did not load/.test(entry.verdict.detail))
    .map((entry) => entry.item.id);

const run = async (items: ReturnType<typeof plannerItems>, seed: number) =>
  evaluate(
    items,
    new SeedData(seed, {}, async () => {
      throw new Error('no scale run');
    }),
  );

describe('the planner v2 family', () => {
  it('passes on the real planner on seed 1', async () => {
    const items = plannerItems();
    const out = await run(items, 1);
    const failing = out
      .filter((entry) => !entry.verdict.pass)
      .map((entry) => `${entry.item.id}: ${entry.verdict.detail}`);
    expect(failing).toEqual([]);
    expect(out.length).toBe(items.length);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it.each(MUTANTS)('a planner that %s loses an item (%s among them)', async (name, expected) => {
    const module = fileURLToPath(new URL(`./fixtures/planner-mutants/${name}.ts`, import.meta.url));
    const out = await run(plannerItems(module, ['rule-of-four', 'weighted']), 1);
    const lost = caught(out);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.some((id) => id.startsWith(expected))).toBe(true);
  });

  it('a planner that plans an omitted budget as zero loses every layers-agree item, the seven of version 2 among them', async () => {
    const module = fileURLToPath(
      new URL('./fixtures/planner-mutants/omitted-budget-is-zero.ts', import.meta.url),
    );
    const items = plannerItems(module).filter((item) => item.id.startsWith('planner.layers-agree.'));
    // The seven shapes of ladder version 2 keep their items; the shapes of version 3 add more.
    const versionTwo = ['floor-only', 'one-variable-rule', 'rule-of-four', 'two-rules', 'constrained', 'weighted', 'wide'];
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining(versionTwo.map((shape) => `planner.layers-agree.${shape}`)),
    );
    const out = await run(items, 1);
    expect(caught(out).sort()).toEqual(items.map((item) => item.id).sort());
  });

  it('a module that does not load fails the family and is caught by no item', async () => {
    const module = fileURLToPath(new URL('./fixtures/planner-mutants/throws-on-load.ts', import.meta.url));
    const out = await run(plannerItems(module, ['rule-of-four']), 1);
    expect(out.some((entry) => !entry.verdict.pass)).toBe(true);
    expect(caught(out)).toEqual([]);
  });
});
