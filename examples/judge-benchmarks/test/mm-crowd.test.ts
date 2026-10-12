import { describe, expect, it } from 'vitest';
import { crowdItem, readingNote } from '../experiments/mm-crowd';
import type { Prompt } from '../src/contestants';
import type { PairItem } from '../src/data';

const item: PairItem = {
  kind: 'pair', id: 'private-item-id', group: 'chat', language: 'xx', label: 'A',
  question: 'What is two plus two?', a: 'Four is the answer.', b: 'Five is the answer.',
};

describe('blind crowd architecture', () => {
  it('collects blind references and isolated readings before using the shared winner contract', async () => {
    const calls: { prompt: Prompt; stage: string }[] = [];
    const result = await crowdItem(item, async (prompt, stage) => {
      calls.push({ prompt, stage });
      const text = stage.startsWith('crowd') ? 'Two plus two equals four.'
        : stage.startsWith('read') ? JSON.stringify({ analysis: 'Arithmetic checked.', evidence: [], uncertain_claims: [] })
          : JSON.stringify({ reasoning: 'The four answer is correct.', winnerQuote: item.a, winner: calls.filter((c) => c.stage === 'compare').length === 1 ? 'A' : 'B' });
      return { key: String(calls.length), model: 'haiku', text, costUsd: 0 };
    });
    expect(calls).toHaveLength(7);
    expect(result.games).toEqual(['A', 'A']);
    for (const { prompt } of calls.slice(0, 3)) {
      expect(prompt.user).not.toContain(item.a);
      expect(prompt.user).not.toContain(item.b);
    }
    expect(JSON.parse(calls[3]!.prompt.user).candidate).toBe(item.a);
    expect(calls[3]!.prompt.user).not.toContain(item.b);
    expect(JSON.parse(calls[4]!.prompt.user).candidate).toBe(item.b);
    expect(calls[4]!.prompt.user).not.toContain(item.a);
    for (const { prompt } of calls) {
      expect(prompt.user).not.toContain(item.id);
      expect(prompt.user).not.toContain('"language":"xx"');
      expect(prompt.user).not.toContain('"label":"A"');
    }
  });

  it('rejects a winner whose quote names the other reply and bounds the shared repair', async () => {
    let comparisons = 0;
    const result = await crowdItem(item, async (_prompt, stage) => {
      if (stage === 'compare') comparisons++;
      const text = stage.startsWith('crowd') ? 'Four.'
        : stage.startsWith('read') ? JSON.stringify({ analysis: 'Checked.', evidence: [], uncertain_claims: [] })
          : JSON.stringify({ reasoning: 'Compare.', winnerQuote: item.b, winner: comparisons === 3 ? 'B' : 'A' });
      return { key: `${stage}-${comparisons}`, model: 'haiku', text, costUsd: 0 };
    });
    // First-order A with the opening of B fails twice, so it stays inconclusive.
    // The swapped repair finally validates A with B's original opening.
    expect(comparisons).toBe(4);
    expect(result.games).toEqual(['tie', 'B']);
  });

  it('drops invented evidence quotes and falls back to the original on invalid reading JSON', () => {
    const valid = readingNote(JSON.stringify({ analysis: 'Mixed evidence.', evidence: [
      { quote: 'Four', observation: 'Supported.' }, { quote: 'secret invented quote', observation: 'Unsupported.' },
    ], uncertain_claims: ['Unverified.'] }), item.a);
    expect(JSON.parse(valid.note).evidence).toHaveLength(1);
    expect(JSON.parse(valid.note).discarded_nonmatching_quotes).toBe(1);
    expect(readingNote('broken JSON', item.a).valid).toBe(false);
  });
});
