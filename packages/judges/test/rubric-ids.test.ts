import { describe, expect, it } from 'vitest';
import { judgeRubric, parseJudgeValue, type RubricItem } from '../src/assessment';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest } from '../src/contract';
import { judgePairwise } from '../src/pairwise';

const items: readonly RubricItem[] = [{ name: '2', rubric: 'The reply contains no commas.' }];
const request: JudgeRequest = {
  criterion: { name: 'format', rubric: 'The reply contains no commas.' },
  transcript: [{ role: 'agent', text: 'the gate opens.' }],
  assessment: { kind: 'rubric', items },
};
const required = { name: '2', score: 4, reasoning: 'No commas.' };

function recordingClient(responses: unknown[], requests: JudgeRequest[]): JudgeClient {
  return {
    id: 'recorded',
    family: 'fixture',
    cls: 'system2',
    cost: 0,
    async judge(r) {
      requests.push(r);
      const value = responses[requests.length - 1];
      if (value === undefined) throw new Error('unexpected extra judge call');
      return { ...parseJudgeValue(value, r), costUsd: 0 };
    },
  };
}

describe('caller-owned rubric identities', () => {
  it('keeps id 2 and ignores prepended question checks, even malformed unknown rows', () => {
    const result = parseJudgeValue(
      {
        items: [{ name: '1', score: 0, reasoning: 'Invented question check.' }, required, { name: 'extra' }],
      },
      request,
    );
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
    expect(result.rubric?.items.map((row) => row.name)).toEqual(['2']);
    expect(result.rubric?.first).toBe(1);
    expect(result.ignoredRequirementIds).toEqual(['1', 'extra']);
  });

  it('computes pair scores from the requested id, without an invented row or winner influencing them', () => {
    const result = parseJudgeValue(
      {
        items: [
          { name: '1', a: 4, b: 0, reasoning: 'Invented check prefers A.' },
          { name: '2', a: 0, b: 4, reasoning: 'Only B contains no commas.' },
          { name: '1', a: null, b: null, reasoning: 'Duplicate unknown row.' },
        ],
      },
      { ...request, assessment: { kind: 'rubric', items, pairwise: true } },
    );
    expect(result.unparsed).toBeUndefined();
    expect(result.winner).toBe('B');
    expect(result.rubric?.first).toBe(0);
    expect(result.rubric?.second).toBe(1);
    expect(result.ignoredRequirementIds).toEqual(['1', '1']);
  });

  it.each([
    [],
    [{ name: '1', score: 4, reasoning: 'Wrong identity.' }],
    [required, required],
    [{ ...required, score: 5 }],
    [{ ...required, score: '4' }],
    [{ ...required, weight: 100 }],
    [{ ...required, name: 2 }],
    [required, null],
    [required, { score: 4 }],
  ])('refuses missing, duplicate or malformed required rows: %j', (...rows) => {
    // Each table entry is an array of response rows.
    const result = parseJudgeValue({ items: rows }, request);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });

  it('retains unknown diagnostics when the required id is missing', () => {
    const result = parseJudgeValue({ items: [{ name: '1' }] }, request);
    expect(result.unparsed).toBe(true);
    expect(result.ignoredRequirementIds).toEqual(['1']);
  });

  it('does not turn score/prose conflict into a repaired score or a winner', () => {
    const result = parseJudgeValue(
      { items: [{ name: '2', a: 4, b: 4, reasoning: 'A violates the rule and should score 0.' }] },
      { ...request, assessment: { kind: 'rubric', items, pairwise: true } },
    );
    expect(result.rubric?.first).toBe(1);
    expect(result.rubric?.second).toBe(1);
    expect(result.winner).toBe('tie');
    expect(result.repaired).toBeUndefined();
  });
});

describe('one rubric repair attempt', () => {
  it('asks once more for a missing id using the same caller requirements and the large budget', async () => {
    const requests: JudgeRequest[] = [];
    const client = recordingClient([{ items: [{ name: '1' }] }, { items: [required] }], requests);
    const result = await judgeRubric(client, request, items);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ ...requests[0], budget: 'large' });
    expect(result.answer.outcome).toBe('pass');
    expect(result.costUsd).toBe(0);
  });

  it('stays inconclusive after two missing-id answers', async () => {
    const requests: JudgeRequest[] = [];
    const client = recordingClient([{ items: [] }, { items: [] }], requests);
    const result = await judgeRubric(client, request, items);
    expect(requests).toHaveLength(2);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });

  it('does not retry valid scores, unknown rows or a legitimate null', async () => {
    for (const score of [4, 0, null]) {
      const requests: JudgeRequest[] = [];
      const client = recordingClient([{ items: [{ ...required, score }, { name: 'extra' }] }], requests);
      const result = await judgeRubric(client, request, items);
      expect(requests).toHaveLength(1);
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.outcome).toBe(score === null ? 'inconclusive' : score === 4 ? 'pass' : 'fail');
    }
  });

  it.each([
    [0.01, 0.02, 0.03],
    [0.01, undefined, 0.01],
    [undefined, 0.02, 0.02],
    [undefined, undefined, undefined],
  ])('sums only reported retry costs: %s + %s', async (firstCost, retryCost, expected) => {
    let calls = 0;
    const client: JudgeClient = {
      id: 'cost-fixture',
      family: 'fixture',
      cls: 'system2',
      cost: 0,
      async judge(r) {
        calls += 1;
        return {
          ...parseJudgeValue({ items: calls === 1 ? [] : [required] }, r),
          costUsd: calls === 1 ? firstCost : retryCost,
        };
      },
    };
    const result = await judgeRubric(client, request, items);
    if (expected === undefined) expect(result.costUsd).toBeUndefined();
    else expect(result.costUsd).toBeCloseTo(expected);
  });

  it.each([undefined, true])('rejects a custom binary pass with unparsed=%s', async (unparsed) => {
    let calls = 0;
    const client: JudgeClient = {
      id: 'binary-fixture',
      family: 'fixture',
      cls: 'system2',
      cost: 0,
      async judge() {
        calls += 1;
        return { raw: '', unparsed, answer: { outcome: 'pass', reasoning: 'No rubric rows.' } };
      },
    };
    const result = await judgeRubric(client, request, items);
    expect(calls).toBe(2);
    expect(result.unparsed).toBe(true);
    expect(result.answer.outcome).toBe('inconclusive');
  });

  it('preserves legacy one-call behavior', async () => {
    const requests: JudgeRequest[] = [];
    const client = recordingClient([{ items: [] }], requests);
    const result = await judgeRubric(client, { ...request, answerContract: 'legacy' }, items);
    expect(requests).toHaveLength(1);
    expect(result.unparsed).toBe(true);
  });

  it('retries a missing pairwise id once and retains id 2 in the swapped pass', async () => {
    const requests: JudgeRequest[] = [];
    const client = recordingClient(
      [
        { items: [{ name: '1', a: 4, b: 4, reasoning: 'Invented check.' }] },
        { items: [{ name: '2', a: 4, b: 0, reasoning: 'A meets it.' }, { name: '1' }] },
        { items: [{ name: '1' }, { name: '2', a: 0, b: 4, reasoning: 'B meets it.' }] },
      ],
      requests,
    );
    const result = await judgePairwise(client, request.criterion, [], 'the gate opens.', 'the gate, opens.', {
      rubricItems: items,
    });
    expect(requests).toHaveLength(3);
    expect(requests[1]?.budget).toBe('large');
    expect(result.choice).toBe('first');
    expect(result.consistent).toBe(true);
    expect(result.calls).toBe(3);
  });
});
