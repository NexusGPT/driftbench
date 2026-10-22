import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, plannerItems, SeedData } from '../../src/ladders/generator';

// Each call of the planner runs in three processes under the frame, so a seed takes minutes.
vi.setConfig({ testTimeout: 1_800_000 });

/**
 * Ladder version 3 of the planner family: each new stem loses its item to a planner with the fault it names, on
 * every seed from 1 to 3, on the shape the stem runs on. A load error or a throw is no catch.
 */
const PLANTED = [
  ['full-product', 'row-cap', 'rule-of-six'],
  ['counts-pinched', 'non-extendable-not-target', 'non-extendable'],
  ['pairs-of-constraints-only', 'odd-size-forbids', 'odd-sizes'],
  ['plans-unapproved', 'approved-only', 'unapproved'],
  ['partial-as-full', 'partial-seed-credit', 'rule-of-four'],
  ['drops-forbidden-seed', 'seed-forbidden-kept', 'constrained'],
  ['drops-unapproved-entry', 'seed-unapproved-covers-nothing', 'unapproved'],
  ['repeats-a-row', 'new-row-novel', 'floor-only'],
  // The review of 4abcaf2c8: a wrong id on a partial seed row, and on a seed row with a value nobody approved.
  ['partial-seed-wrong-ids', 'partial-seed-credit', 'rule-of-four'],
  ['unapproved-seed-wrong-id', 'seed-unapproved-covers-nothing', 'unapproved'],
  ['raw-weights', 'weight-scale-invariance', 'weighted'],
  ['zero-weight-first', 'zero-weight-last', 'zero-weight'],
  // The review of 3f1eebd93: every finite weight is 999 on the zero-weight shape.
  ['finite-weights-999', 'zero-weight-last', 'zero-weight'],
  // The review of 86c63a43e: the JSON writes every finite weight as 999, the plan in memory stays right.
  ['json-weights-999', 'zero-weight-last', 'zero-weight'],
  ['key-order-sensitive', 'key-order-invariance', 'two-rules'],
  ['unweighted-as-one', 'traffic-weight-of-a-row', 'mixed-weights'],
] as const;

/** The wrong planners of the version 3 plan: each loses at least one item of the shape on seeds 1 to 3. */
const WRONG_PLANNERS = [
  ['pairs-only', 'rule-of-four'],
  ['strength-three-everywhere', 'rule-of-four'],
  ['strength-three-everywhere', 'floor-only'],
  // The planner that ignores the seed rows.
  ['ignores-seeds', 'rule-of-four'],
  // The planner that does not order the new rows by traffic.
  ['reverses-order', 'weighted'],
] as const;

const run = async (items: ReturnType<typeof plannerItems>, seed: number) =>
  evaluate(
    items,
    new SeedData(seed, {}, async () => {
      throw new Error('no scale run');
    }),
  );

describe('the planner family, ladder version 3', () => {
  it.each(PLANTED)(
    'a planner with the fault %s loses %s on %s, on seeds 1 to 3',
    async (name, stem, shape) => {
      const module = fileURLToPath(new URL(`./fixtures/planner-mutants/${name}.ts`, import.meta.url));
      const items = plannerItems(module, [shape]).filter((item) => item.id === `planner.${stem}.${shape}`);
      expect(items).toHaveLength(1);
      for (const seed of [1, 2, 3]) {
        const [entry] = await run(items, seed);
        expect(entry?.verdict.pass, `seed ${seed}`).toBe(false);
        expect(entry?.verdict.detail ?? '').not.toMatch(/the item threw|did not load/);
      }
    },
  );

  it.each(WRONG_PLANNERS)('a wrong planner, %s, loses an item of %s on seeds 1 to 3', async (name, shape) => {
    const module = fileURLToPath(new URL(`./fixtures/planner-mutants/${name}.ts`, import.meta.url));
    const items = plannerItems(module, [shape]).filter((item) => item.id.endsWith(`.${shape}`));
    for (const seed of [1, 2, 3]) {
      const lost = (await run(items, seed)).filter(
        (entry) => !entry.verdict.pass && !/the item threw|did not load/.test(entry.verdict.detail),
      );
      expect(lost.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('runs every new stem on the shapes it names, under ids no other item holds', () => {
    const ids = plannerItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, stem, shape] of PLANTED) expect(ids).toContain(`planner.${stem}.${shape}`);
  });
});
