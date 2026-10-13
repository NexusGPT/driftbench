import { expect, it } from 'vitest';
import { voteChat } from '../experiments/mm-vote3';
import type { PairItem } from '../src/data';

it('pools native declared winners by original candidate and retains all six raw games', async () => {
  const item: PairItem = {
    kind: 'pair',
    id: 'private-test-id',
    group: 'chat',
    language: 'en',
    label: 'B',
    question: 'Choose useful assistance.',
    a: 'First useful reply.',
    b: 'Second useful reply.',
  };
  const rawWinners = ['A', 'B', 'B', 'B', 'A', 'A'];
  let call = 0;
  const result = await voteChat(item, async (prompt) => {
    expect(prompt.user).not.toContain(item.id);
    expect(prompt.user).not.toContain('"label":"B"');
    const index = call++,
      winner = rawWinners[index]!;
    const candidateA = index % 2 === 0 ? item.a : item.b,
      candidateB = index % 2 === 0 ? item.b : item.a;
    return {
      model: 'haiku',
      key: `vote-${index}`,
      text: JSON.stringify({
        reasoning: 'Compare substantive usefulness.',
        winner,
        winnerQuote: winner === 'A' ? candidateA : candidateB,
      }),
      costUsd: 0,
    };
  });
  expect(result.games).toEqual(['A', 'A']);
  expect(result.samples.map((s) => s.games)).toEqual([
    ['A', 'A'],
    ['B', 'A'],
    ['A', 'B'],
  ]);
  expect(result.rawComparisons.map((r) => r.rawWinner)).toEqual(rawWinners);
  expect(result.rawComparisons).toHaveLength(6);
});
