import { describe, expect, it } from 'vitest';
import { comparePair, type PairJudge } from '../src/compare-pair';

const criterion = { name: 'resolves', rubric: 'Which reply resolves the request better?' };
const a = [{ role: 'agent' as const, text: 'Reply one.' }];
const b = [{ role: 'agent' as const, text: 'Reply two.' }];

/** A pair judge answering from a script: the answers it gives for the ordered and the swapped call. */
function scripted(
  answers: readonly ('first' | 'second' | 'tie' | 'inconclusive')[],
): PairJudge & { calls: number } {
  let calls = 0;
  return {
    id: 'pair',
    get calls() {
      return calls;
    },
    async judgePair() {
      const answer = answers[calls] ?? 'inconclusive';
      calls += 1;
      return answer;
    },
  };
}

describe('comparePair: two candidates, judged in both orders', () => {
  it('names the winner when both orders agree on it', async () => {
    expect((await comparePair(scripted(['first', 'second']), { criterion, a, b })).winner).toBe('a');
    expect((await comparePair(scripted(['second', 'first']), { criterion, a, b })).winner).toBe('b');
  });

  it('is a tie when both orders say tie, and inconclusive when they disagree', async () => {
    expect((await comparePair(scripted(['tie', 'tie']), { criterion, a, b })).winner).toBe('tie');
    expect((await comparePair(scripted(['first', 'first']), { criterion, a, b })).winner).toBe(
      'inconclusive',
    );
  });

  it('asks in both orders and reports two calls', async () => {
    const judge = scripted(['first', 'second']);
    const result = await comparePair(judge, { criterion, a, b });
    expect(judge.calls).toBe(2);
    expect(result.calls).toBe(2);
  });

  it('gives inconclusive when the judge throws', async () => {
    const failing: PairJudge = {
      id: 'pair',
      async judgePair() {
        throw new Error('down');
      },
    };
    expect((await comparePair(failing, { criterion, a, b })).winner).toBe('inconclusive');
  });
});
