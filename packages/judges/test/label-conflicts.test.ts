import { describe, expect, it } from 'vitest';
import { labelConflicts } from '../src/calibration';

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
