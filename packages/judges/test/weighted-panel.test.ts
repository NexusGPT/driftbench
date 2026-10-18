import { describe, expect, it } from 'vitest';
import { majority } from '../src/council';
import { type PanelVote, weightedPanel } from '../src/weighted-panel';

const vote = (judge: string, outcome: PanelVote['outcome']): PanelVote => ({ judge, outcome });
const equal = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 1]));

describe('weightedPanel', () => {
  it('with equal weights, every three-vote panel decides as plain majority does', () => {
    const outcomes: PanelVote['outcome'][] = ['pass', 'fail', 'inconclusive'];
    const ids = ['a', 'b', 'c'];
    for (const x of outcomes)
      for (const y of outcomes)
        for (const z of outcomes) {
          const votes = [vote('a', x), vote('b', y), vote('c', z)];
          const plain = majority(votes as never);
          const weighted = weightedPanel(votes, equal(ids));
          expect(weighted === 'split' ? 'split' : weighted, `${x} ${y} ${z}`).toBe(
            plain === 'split' ? 'split' : plain,
          );
        }
  });

  it('a judge with weight 0 has no say', () => {
    const votes = [vote('a', 'pass'), vote('b', 'fail'), vote('c', 'fail')];
    expect(weightedPanel(votes, { a: 0, b: 1, c: 1 })).toBe('fail');
  });

  it('abstains when the weighted margin is thin', () => {
    // pass and fail carry 1 and 1, and a weak judge adds 0.2 to pass: the margin is 0.09 of the total weight.
    const votes = [vote('a', 'pass'), vote('b', 'fail'), vote('c', 'pass')];
    expect(weightedPanel(votes, { a: 1, b: 1, c: 0.2 })).toBe('split');
  });

  it('decides when the weighted margin is wide', () => {
    const votes = [vote('a', 'pass'), vote('b', 'pass'), vote('c', 'fail')];
    expect(weightedPanel(votes, { a: 1, b: 1, c: 0.2 })).toBe('pass');
  });

  it('never decides from inconclusive votes alone, and a panel with no weight is a split', () => {
    expect(weightedPanel([vote('a', 'inconclusive'), vote('b', 'inconclusive')], { a: 1, b: 1 })).toBe(
      'split',
    );
    expect(weightedPanel([vote('a', 'pass')], {})).toBe('split');
  });
});

describe('the package index', () => {
  it('exports weightedPanel, as the judges page says', async () => {
    const index: Record<string, unknown> = await import('../src/index');
    expect(index.weightedPanel).toBe(weightedPanel);
  });
});
