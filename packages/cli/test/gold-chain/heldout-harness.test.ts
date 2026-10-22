import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runUnitsEstate } from './heldout';
import { scoreLimits } from './heldout-score';
import { loadUnitsEstate } from './units-estate';

/**
 * The held-out harness on a made-up estate of three units and two limits (fixtures/tiny-units). The model is a stub
 * that answers from the unit text of the request: unit 1 exactly right, unit 2 with the right number and another
 * comparison, unit 3 (a year) as a limit. It is not a held-out estate, so no held-out data is seen here.
 */
const FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny-units');

const answers: Record<string, unknown> = {
  'Reply in at most two sentences.': {
    limits: [{ limit: 2, comparison: 'le', role: 'constraint', unit: 'sentences' }],
  },
  'Wait five minutes before the second reminder.': {
    limits: [{ limit: 5, comparison: 'gt', role: 'constraint', unit: 'minutes' }],
  },
  "The shop is called Pip's Pets and has been open since 1998.": {
    limits: [{ limit: 1998, comparison: 'ge', role: 'constraint' }],
  },
};

describe('the held-out harness on a made-up estate', () => {
  it('reads the units table of the estate in place of gold ids', async () => {
    const estate = await loadUnitsEstate(FOLDER);
    expect(estate.truth.units.map((unit) => unit.id)).toEqual(['t1', 't2', 't3']);
    expect(estate.truth.limits.map((limit) => `${limit.unit}:${limit.limit}`)).toEqual(['t1:2', 't2:5']);
    expect(estate.truth.nonLimits.map((entry) => entry.unit)).toEqual(['t3']);
    expect(estate.files.map((file) => file.path)).toEqual(['T-standing-instructions.md']);
  });

  it('scores limits and non-limits separately', () => {
    const truth = {
      estate: 'x',
      units: [],
      limits: [
        { unit: 'a', limit: 2, comparison: 'le', role: 'constraint', governs: 'a' },
        { unit: 'b', limit: 5, comparison: 'ge', role: 'constraint', governs: 'b' },
        { unit: 'c', limit: 9, comparison: 'le', role: 'constraint', governs: 'c' },
      ],
      nonLimits: [{ unit: 'd', number: 1998, why: 'a year' }],
    };
    const score = scoreLimits(truth, [
      { unit: 'a', limit: 2, comparison: 'le', role: 'constraint' },
      { unit: 'b', limit: 5, comparison: 'gt', role: 'constraint' },
      { unit: 'd', limit: 1998, comparison: 'ge', role: 'constraint' },
      { unit: 'e', limit: 3, comparison: 'le', role: 'constraint' },
    ]);
    expect(score.limits).toEqual({ truth: 3, found: 2, exact: 1, missing: ['c'] });
    expect(score.produced).toEqual({ total: 4, matched: 2, nonLimitHits: 1, otherExtras: 1 });
    expect(score.nonLimits).toEqual({ truth: 1, hit: ['d'] });
    expect(score.recall).toBeCloseTo(2 / 3);
    expect(score.exactRecall).toBeCloseTo(1 / 3);
    expect(score.precision).toBeCloseTo(2 / 4);
  });

  it('runs the producer on the units of the estate and scores it against the truth file', async () => {
    const asked: string[] = [];
    const result = await runUnitsEstate({
      folder: FOLDER,
      ask: async (request) => {
        const text = Object.keys(answers).find((unit) => request.user.endsWith(unit));
        asked.push(text ?? 'unknown');
        return JSON.stringify(answers[text ?? ''] ?? { limits: [] });
      },
    });
    expect(result.unmatched).toEqual([]);
    expect(asked.sort()).toEqual(Object.keys(answers).sort());
    expect(result.score.limits).toEqual({ truth: 2, found: 2, exact: 1, missing: [] });
    expect(result.score.produced).toEqual({ total: 3, matched: 2, nonLimitHits: 1, otherExtras: 0 });
    expect(result.score.nonLimits).toEqual({ truth: 1, hit: ['t3'] });
    expect(result.score.precision).toBeCloseTo(2 / 3);
  });
});
