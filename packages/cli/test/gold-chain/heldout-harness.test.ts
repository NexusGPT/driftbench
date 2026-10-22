import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runUnitsEstate } from './heldout';
import { scoreLimits } from './heldout-score';
import { loadUnitsEstate, parseUnitsTruth } from './units-estate';

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

  it('keeps an id that looks like a number as text', () => {
    const truth = parseUnitsTruth(
      [
        'version: 1',
        'estate: x',
        'units:',
        '  - id: 9651728e54',
        '    file: a.md',
        '    text: "A."',
        'limits: []',
        'non_limits: []',
      ].join('\n'),
    );
    expect(truth.units.map((unit) => unit.id)).toEqual(['9651728e54']);
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
      nonLimits: [{ unit: 'd', number: '1998', why: 'a year' }],
    };
    const score = scoreLimits(truth, [
      { unit: 'a', limit: 2, comparison: 'le', role: 'constraint' },
      { unit: 'b', limit: 5, comparison: 'gt', role: 'constraint' },
      { unit: 'd', limit: 1998, comparison: 'ge', role: 'constraint' },
      { unit: 'e', limit: 3, comparison: 'le', role: 'constraint' },
    ]);
    expect(score.limits).toEqual({ truth: 3, found: 2, exact: 1, missing: ['c'], unreachable: [] });
    expect(score.produced).toEqual({ total: 4, matched: 2, nonLimitHits: 1, otherExtras: 1 });
    expect(score.nonLimits).toEqual({ truth: 1, hit: ['d'] });
    const apart = scoreLimits(truth, [], new Set(['a', 'b']));
    expect(apart.limits.unreachable).toEqual(['c']);
    expect(apart.limits.missing).toEqual(['a', 'b', 'c']);
    // Two of the three limits are found, and one of the three is unreachable: 2 / (3 - 1) = 1, against 2 / 3 over all.
    const withUnreachable = scoreLimits(
      truth,
      [
        { unit: 'a', limit: 2, comparison: 'le', role: 'constraint' },
        { unit: 'b', limit: 5, comparison: 'ge', role: 'constraint' },
      ],
      new Set(['a', 'b']),
    );
    expect(withUnreachable.recall).toBeCloseTo(2 / 3);
    expect(withUnreachable.reachableRecall).toBeCloseTo(1);
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
    expect(result.score.limits).toEqual({ truth: 2, found: 2, exact: 1, missing: [], unreachable: [] });
    expect(result.score.produced).toEqual({ total: 3, matched: 2, nonLimitHits: 1, otherExtras: 0 });
    expect(result.score.nonLimits).toEqual({ truth: 1, hit: ['t3'] });
    expect(result.score.precision).toBeCloseTo(2 / 3);
  });

  it('names a unit of the table that the scan does not cut, and a unit of the scan that the table does not list', async () => {
    const result = await runUnitsEstate({
      folder: join(dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny-mismatch'),
      ask: async () => JSON.stringify({ limits: [{ limit: 2, comparison: 'le', role: 'constraint' }] }),
    });
    expect(result.unmatched).toEqual(['m2']);
    // The heading is a unit of the scan too, and the table does not list it.
    expect(result.outside).toEqual([
      'CLAUDE.md#1: # Tiny, a second made-up estate',
      'CLAUDE.md#3: Close the chat after ten idle minutes.',
    ]);
    expect(result.requests).toBe(1);
    expect(result.score.limits).toEqual({ truth: 1, found: 1, exact: 1, missing: [], unreachable: [] });
  });

  it('names every bad entry of a truth file, and drops none', () => {
    const text = [
      'version: 1',
      'estate: x',
      'units:',
      '  - id: u1',
      '    file: a.md',
      '    text: "A."',
      '  - just a string',
      '  - id: u3',
      '    file: a.md',
      'limits:',
      '  - unit: u1',
      '    limit: two',
      '    comparison: le',
      '    role: constraint',
      '  - nonsense',
      'non_limits:',
      '  - unit: u9',
      '    number: "1"',
      '    why: "a year"',
    ].join('\n');
    let message = '';
    try {
      parseUnitsTruth(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split('\n')).toEqual([
      'the truth file has problems:',
      'units[1]: not a mapping',
      'units[2]: no text',
      'limits[1]: not a mapping',
      'limits[0]: no governs',
      'limits[0] (u1): the limit is not a number',
      'non_limits[0]: u9 is not a unit',
    ]);
  });

  it('uses the planted refers_to and limits_table: the pointer gets a REFERRED block, the table one request, nothing else changes', async () => {
    const folder = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/tiny-planted');
    const seen: string[] = [];
    const ask = async (request: { system: string; user: string }): Promise<string> => {
      seen.push(request.user);
      if (request.user.includes('REFERRED:\nA stall may be rented for at most 14 nights.'))
        return JSON.stringify({ limits: [{ limit: 14, comparison: 'le', role: 'constraint' }] });
      if (request.user.startsWith('TABLE HEADER:'))
        return JSON.stringify({
          limits: [
            { row: 1, limit: 14, comparison: 'le', role: 'constraint' },
            { row: 2, limit: 30, comparison: 'le', role: 'constraint' },
          ],
        });
      return '{"limits": []}';
    };
    const planted = await runUnitsEstate({ folder, ask });
    expect(planted.score.limits).toEqual({ truth: 3, found: 3, exact: 3, missing: [], unreachable: [] });
    expect(seen.filter((user) => user.includes('REFERRED:'))).toHaveLength(1);
    expect(seen.filter((user) => user.startsWith('TABLE HEADER:'))).toHaveLength(1);
    // The neighbour that nothing points at is asked as it always was.
    expect(seen.find((user) => user.endsWith('INSTRUCTION:\nGreet the rider by name.'))).not.toContain('REFERRED');
    // Without the planted fields the pointer gets no number (the stub answers only a REFERRED request) and the table rows are out of reach.
    const plain = await runUnitsEstate({ folder, ask, planted: false });
    expect(plain.score.limits.found).toBe(0);
    expect(plain.score.limits.unreachable.sort()).toEqual(['r1', 'r2']);
  });
});
