import { describe, expect, it } from 'vitest';
import { agreement, fixtureLeaks, labelConflicts, labelWarnings } from '../src/calibration';

const block = (id: string, label: 'pass' | 'fail', text: string) => ({
  id,
  label,
  transcript: [{ role: 'agent' as const, text }],
});

describe('labelConflicts', () => {
  it('names the blocks that hold one slice under opposite labels', () => {
    const blocks = [block('a', 'pass', 'same'), block('b', 'fail', 'same'), block('c', 'pass', 'other')];
    expect(labelConflicts(blocks)).toEqual([['a', 'b']]);
  });
  it('lets the same slice repeat under one label', () => {
    expect(labelConflicts([block('a', 'pass', 'same'), block('b', 'pass', 'same')])).toEqual([]);
  });
});

describe('fixtureLeaks', () => {
  it('names the labelled blocks equal to a fixture of the criterion', () => {
    const criterion = {
      path: 'c.yaml',
      def: { name: 'c', rubric: 'r', pass: 'p', fail: 'f', gating: true },
      fixtures: {
        pass: { transcript: [{ role: 'agent' as const, text: 'yes' }] },
        fail: { transcript: [{ role: 'agent' as const, text: 'no' }] },
      },
    } as unknown as Parameters<typeof fixtureLeaks>[0];
    const blocks = [block('leak', 'pass', 'yes'), block('own', 'fail', 'something else')];
    expect(fixtureLeaks(criterion, blocks)).toEqual(['leak']);
  });
});

describe('labelWarnings', () => {
  it('warns few-labels when a class holds fewer than 5 blocks', () => {
    const many = (label: 'pass' | 'fail', n: number) =>
      Array.from({ length: n }, (_, i) => block(`${label}${i}`, label, `${label} ${i}`));
    expect(labelWarnings([...many('pass', 16), ...many('fail', 4)])).toEqual(['few-labels']);
    expect(labelWarnings([...many('pass', 5), ...many('fail', 5)])).toEqual([]);
    expect(labelWarnings([])).toEqual([]);
  });
});

describe('kappa with one class of labels', () => {
  it('is left out when every label is the same class', () => {
    const r = agreement(['a', 'b', 'c'], ['pass', 'pass', 'pass'], ['pass', 'pass', 'fail']);
    expect(r.kappa).toBeUndefined();
    expect(r.agree).toBe(2);
  });
  it('is computed when both classes are labelled', () => {
    expect(agreement(['a', 'b'], ['pass', 'fail'], ['pass', 'fail']).kappa).toBe(1);
  });
});
