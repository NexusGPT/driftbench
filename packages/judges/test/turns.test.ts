import { describe, expect, it } from 'vitest';
import { FakeJudge } from '../src/clients/fake';
import type { JudgeRequest } from '../src/contract';
import { judgeTurns } from '../src/turns';

const criterion = { name: 'resolves', rubric: 'Did the agent resolve the request?' };
const base = (transcript: JudgeRequest['transcript']): JudgeRequest => ({ criterion, transcript });
const pass = { outcome: 'pass' as const, reasoning: 'ok' };
const fail = { outcome: 'fail' as const, reasoning: 'no' };

describe('judgeTurns: a conversation is judged turn by turn', () => {
  it('judges each turn on the prefix that ends where the next turn starts', async () => {
    const judge = new FakeJudge('j', [pass, fail]);
    const result = await judgeTurns(
      judge,
      base([
        { role: 'user', text: 'first' },
        { role: 'agent', text: 'reply one' },
        { role: 'user', text: 'second' },
        { role: 'agent', text: 'reply two' },
      ]),
    );
    expect(judge.requests.map((r) => r.transcript.length)).toEqual([2, 4]);
    expect(judge.requests[0]?.criterion).toEqual(criterion);
    expect(result.turns).toEqual([
      { turn: 1, outcome: 'pass' },
      { turn: 2, outcome: 'fail' },
    ]);
    expect(result.outcome).toBe('fail');
    expect(result.firstFailing).toBe(2);
  });

  it('treats consecutive customer messages as one turn, and context entries as no turn', async () => {
    const judge = new FakeJudge('j', [pass, pass]);
    const result = await judgeTurns(
      judge,
      base([
        { role: 'context', text: 'stage: offer' },
        { role: 'user', text: 'first' },
        { role: 'user', text: 'and also this' },
        { role: 'agent', text: 'reply' },
        { role: 'user', text: 'second' },
        { role: 'agent', text: 'reply two' },
      ]),
    );
    expect(result.turns.map((t) => t.turn)).toEqual([1, 2]);
    expect(judge.requests[0]?.transcript.length).toBe(4);
  });

  it('makes a turn inconclusive when its judge gives no answer', async () => {
    const judge = new FakeJudge('j', [pass, new Error('down')]);
    const result = await judgeTurns(
      judge,
      base([
        { role: 'user', text: 'first' },
        { role: 'agent', text: 'a' },
        { role: 'user', text: 'second' },
        { role: 'agent', text: 'b' },
      ]),
    );
    expect(result.turns[1]?.outcome).toBe('inconclusive');
    expect(result.outcome).toBe('inconclusive');
  });

  it('reports the first turn after the first failing one that passes', async () => {
    const judge = new FakeJudge('j', [pass, fail, { outcome: 'inconclusive', reasoning: '?' }, pass]);
    const result = await judgeTurns(
      judge,
      base([
        { role: 'user', text: '1' },
        { role: 'agent', text: 'a' },
        { role: 'user', text: '2' },
        { role: 'agent', text: 'b' },
        { role: 'user', text: '3' },
        { role: 'agent', text: 'c' },
        { role: 'user', text: '4' },
        { role: 'agent', text: 'd' },
      ]),
    );
    expect(result.firstFailing).toBe(2);
    expect(result.recoveredAt).toBe(4);
  });

  it('refuses a transcript with no customer message', async () => {
    await expect(
      judgeTurns(new FakeJudge('j', [pass]), base([{ role: 'agent', text: 'hi' }])),
    ).rejects.toThrow(RangeError);
  });
});
