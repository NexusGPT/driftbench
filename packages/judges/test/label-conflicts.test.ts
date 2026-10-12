import { describe, expect, it } from 'vitest';
import { fixtureLeaks, labelConflicts } from '../src/calibration';

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
