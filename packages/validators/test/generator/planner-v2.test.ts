import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, plannerItems, SeedData } from '../../src/ladders/generator';

// Each call of the planner runs in three processes under the frame, so a seed takes minutes.
vi.setConfig({ testTimeout: 1_800_000 });

const MUTANTS = [
  ['drops-last-row', 'planner.own-rule-tuples'],
  ['ignores-seeds', 'planner.seeds-lead'],
  ['ignores-budget', 'planner.budget-prefix'],
  ['reverses-order', 'planner.rarest-cut-first'],
  ['cuts-seeds', 'planner.budget-keeps-seeds'],
  ['forbidden-row', 'planner.no-forbidden-row'],
  ['flat-weights', 'planner.traffic-weight-of-a-row'],
  ['drops-odd-seed', 'planner.hostile.unknown-seed-value-kept'],
  ['stale-cut-count', 'planner.budget-cut-count'],
  ['pairs-only', 'planner.own-rule-tuples'],
] as const;

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
    const lost = out.filter((entry) => !entry.verdict.pass).map((entry) => entry.item.id);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.some((id) => id.startsWith(expected))).toBe(true);
  });
});
