import { describe, expect, it } from 'vitest';
import { runPassed } from '../src/data';
import { renderRun } from '../src/html';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

const three = {
  blocks: [{ when: { user: 'one' } }, { when: { user: 'two' } }, { when: { user: 'three' } }],
  end: { verdict: 'success' as const, reason: 'the order is placed', atBlock: 0 },
};

describe('a run a verdict stopped early shows the blocks it skipped', () => {
  it('lists the skipped spec blocks, not as failed, and says where the run stopped', () => {
    const stopped = { ...run({ blocks: [{ text: 'hi' }] }), endVerdict: 'success' as const };
    const detail = runDetailOf(dataOf([stopped], { 'spec-a': three }), stopped);
    expect(detail.stopped).toEqual({
      verdict: 'success',
      reason: 'the order is placed',
      after: 0,
      skipped: [
        { index: 1, id: 'b2', stimulus: 'two' },
        { index: 2, id: 'b3', stimulus: 'three' },
      ],
    });
    const html = renderRun(detail);
    expect(html).toContain('Stopped by verdict: success (the order is placed)');
    expect(html).toContain('The run stopped after block 1.');
    expect(html).toContain('skipped by the verdict');
  });

  it('a run that ran every block has no stopped section', () => {
    const full = {
      ...run({ blocks: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }),
      endVerdict: 'success' as const,
    };
    const detail = runDetailOf(dataOf([full], { 'spec-a': three }), full);
    expect(detail.stopped).toBeUndefined();
    expect(renderRun(detail)).not.toContain('Stopped by verdict');
  });
});

it('does not count an inconclusive driver verdict as a passed run', () => {
  const inconclusive = { ...run({ blocks: [{ text: 'hi' }] }), endVerdict: 'inconclusive' as const };
  expect(runPassed(inconclusive)).toBe(false);
});
