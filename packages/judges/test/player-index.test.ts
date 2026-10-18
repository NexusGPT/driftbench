import { describe, expect, it } from 'vitest';
import { type Cassette, playerClient } from '../src/cassette';

describe('playerClient', () => {
  it('indexes the entries once, so a call does not read the entry list again', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      judge: 'j',
      key: `k${i}`,
      answer: { outcome: 'pass', reasoning: `r${i}` },
    }));
    const cassette = {
      version: 1,
      judges: [{ id: 'j', family: 'f', cls: 'system1', cost: 1 }],
      entries,
    } as unknown as Cassette;
    const player = playerClient(cassette, 'j');
    Object.defineProperty(cassette, 'entries', {
      get() {
        throw new Error('the entry list was read again');
      },
    });
    const request = { criterion: { name: 'c', rubric: 'r' }, transcript: [] };
    // The key of this request is not in the list: the miss must come from the index, not from a rescan.
    await expect(player.judge(request)).rejects.toThrow(/no recording/);
  });
});
