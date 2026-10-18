import { Vote as StoredVote } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import type { JudgeClient } from '../src/client';
import type { JudgeResult } from '../src/contract';
import { createCouncil } from '../src/council';
import { pairwiseRequest } from '../src/pairwise';

const request = pairwiseRequest({ name: 'correct', rubric: 'Correct answer.' }, [], '4', '5');

function seat(id: string, winner?: JudgeResult['winner'], unparsed = false): JudgeClient {
  return {
    id,
    family: id,
    cls: 'system2',
    cost: 1,
    judge: vi.fn(async () => ({
      ...(winner ? { winner } : {}),
      unparsed,
      // Deliberately contradict A and tie: the named winner must decide.
      answer: { outcome: 'fail' as const, reasoning: `Reply ${winner ?? 'unknown'} is better.` },
      raw: '',
    })),
  };
}

describe('a council seats the named pairwise contract', () => {
  it('counts the winner field and retains it in serializable votes', async () => {
    const judges = [seat('one', 'A'), seat('two', 'A'), seat('three', 'B')];
    const result = await createCouncil({ mode: 'llm', agentFamily: 'none', judges }).judge(request);
    expect(result).toMatchObject({ winner: 'A', outcome: 'pass', split: false });
    expect(result.votes.map((vote) => vote.winner)).toEqual(['A', 'B', 'A']);
    for (const vote of result.votes) expect(StoredVote.parse(vote).winner).toBe(vote.winner);
    expect(
      judges.every((judge) => vi.mocked(judge.judge).mock.calls[0]?.[0].assessment?.kind === 'pairwise'),
    ).toBe(true);
  });

  it('distinguishes an agreed tie from missing data without another round', async () => {
    const judges = [seat('one', 'tie'), seat('two', 'tie'), seat('three', 'A')];
    const result = await createCouncil({ mode: 'llm', agentFamily: 'none', judges }).judge(request);
    expect(result).toMatchObject({ winner: 'tie', outcome: 'inconclusive', split: false });
    expect(result.rounds).toHaveLength(1);
    expect(judges.map((judge) => vi.mocked(judge.judge).mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('never invents a named winner from a binary answer or invalid response', async () => {
    const judges = [seat('one'), seat('two', 'A', true), seat('three', 'inconclusive')];
    const result = await createCouncil({ mode: 'llm', agentFamily: 'none', judges }).judge(request);
    expect(result).toMatchObject({ winner: 'inconclusive', outcome: 'inconclusive', split: true });
    expect(result.votes.every((vote) => vote.winner === 'inconclusive')).toBe(true);
  });

  it('keeps the binary contract outside pairwise judging', async () => {
    const judges = [seat('one', 'A'), seat('two', 'A'), seat('three', 'B')];
    const result = await createCouncil({ mode: 'llm', agentFamily: 'none', judges }).judge({
      criterion: request.criterion,
      transcript: [],
    });
    expect(result.outcome).toBe('fail');
    expect(result).not.toHaveProperty('winner');
    expect(result.votes.every((vote) => vote.winner === undefined)).toBe(true);
  });
});

describe('constituent judge families', () => {
  it('rejects a composite seat hiding the agent family behind its first judge', () => {
    const composite = { ...seat('anthropic', 'A'), families: ['anthropic', 'openai'] };
    expect(() => createCouncil({ mode: 'llm', size: 1, agentFamily: 'openai', judges: [composite] })).toThrow(
      /family/,
    );
    expect(composite.judge).not.toHaveBeenCalled();
  });

  it('resolves model-name aliases before checking a constituent family', () => {
    const composite = { ...seat('anthropic', 'A'), families: ['anthropic', ' GPT-4o '] };
    expect(() => createCouncil({ mode: 'llm', size: 1, agentFamily: 'OpenAI', judges: [composite] })).toThrow(
      /family/,
    );
    expect(composite.judge).not.toHaveBeenCalled();
  });
});
