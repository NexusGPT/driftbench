import { describe, expect, it } from 'vitest';
import {
  aggregateCriteria,
  criterionPrompt,
  criterionRequest,
  DECOMPOSED_CONFIG,
  deriveWritingBrief,
  parseCriterionScores,
  parseWritingBrief,
  scoredWinner,
  writingCriteria,
} from '../src/wp-decomposed';

const brief = {
  requirements: [
    { requirement: 'Write a story', sourceQuote: 'story' },
    { requirement: 'Use a hopeful ending', sourceQuote: 'hopeful' },
  ],
  development: 'Enact the character change through consequential scenes.',
  craft: 'Use coherent causality and a distinctive narrative voice.',
};
const criteria = writingCriteria(brief);
const request = criterionRequest('Write a hopeful story', 'Alpha scene', 'Beta scene', criteria);
const scores = (a: number[], b: number[]) =>
  JSON.stringify({
    items: criteria.map((x, i) => ({ name: x.name, a: a[i], b: b[i], reasoning: 'scenes' })),
  });

describe('request-blind decomposed writing judge', () => {
  it('derives criteria without candidates, ids, or human labels', () => {
    const p = deriveWritingBrief('Write a hopeful story');
    expect(p.user).toBe('<input_data>\nWrite a hopeful story\n</input_data>');
    expect(p.user).not.toContain('Alpha scene');
    expect(parseWritingBrief(JSON.stringify(brief), 'Write a hopeful story')).toEqual(brief);
    expect(
      parseWritingBrief(
        JSON.stringify({ ...brief, requirements: [{ requirement: 'Add a car', sourceQuote: 'car' }] }),
        'Write a hopeful story',
      ),
    ).toBeUndefined();
  });
  it('keeps group weights fixed even when a request has more requirements', () => {
    expect(criteria.reduce((n, x) => n + (x.weight ?? 0), 0)).toBe(1);
    const expanded = writingCriteria({
      ...brief,
      requirements: [...brief.requirements, { requirement: 'Another constraint', sourceQuote: 'another' }],
    });
    expect(
      expanded.filter((x) => x.name.startsWith('requirement')).reduce((n, x) => n + (x.weight ?? 0), 0),
    ).toBeCloseTo(DECOMPOSED_CONFIG.weights.requirements);
  });
  it('renders actual criteria and both complete responses; a repair is a distinct prompt', () => {
    const p = criterionPrompt(request);
    for (const c of criteria) expect(p.user).toContain(c.rubric);
    expect(p.user).toContain('Alpha scene');
    expect(p.user).toContain('Beta scene');
    expect(criterionPrompt(request, true).user).not.toBe(p.user);
  });
  it('aggregates item scores in code, without a model winner', () => {
    const r = parseCriterionScores(scores([4, 4, 1, 1], [2, 2, 4, 4]), request);
    expect(scoredWinner(r)).toBe('B');
    const parts = criteria.map((c, i) =>
      parseCriterionScores(
        JSON.stringify({
          items: [{ name: c.name, a: [4, 4, 1, 1][i], b: [2, 2, 4, 4][i], reasoning: 'observed' }],
        }),
        criterionRequest('q', 'a', 'b', [c]),
      ),
    );
    expect(aggregateCriteria(request, parts).rubric?.first).toBeCloseTo(r.rubric!.first!);
    expect(scoredWinner(aggregateCriteria(request, parts))).toBe('B');
    expect(parseCriterionScores(JSON.stringify({ items: [], winner: 'A' }), request).unparsed).toBe(true);
  });
  it('rejects duplicate, missing, out-of-range and invented criterion scores', () => {
    const v = JSON.parse(scores([4, 4, 4, 4], [3, 3, 3, 3]));
    expect(parseCriterionScores(JSON.stringify({ ...v, items: v.items.slice(1) }), request).unparsed).toBe(
      true,
    );
    expect(
      parseCriterionScores(JSON.stringify({ ...v, items: [...v.items, v.items[0]] }), request).unparsed,
    ).toBe(true);
    v.items[0].a = 5;
    expect(parseCriterionScores(JSON.stringify(v), request).unparsed).toBe(true);
    expect(scoredWinner(aggregateCriteria(request, []))).toBe('tie');
  });
  it('preserves ties and unknowns rather than inventing a winner', () => {
    expect(scoredWinner(parseCriterionScores(scores([4, 4, 4, 4], [4, 4, 4, 4]), request))).toBe('tie');
    const v = JSON.parse(scores([4, 4, 4, 4], [3, 3, 3, 3]));
    v.items[0].a = null;
    expect(scoredWinner(parseCriterionScores(JSON.stringify(v), request))).toBe('tie');
  });
});
