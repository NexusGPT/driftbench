import { describe, expect, it } from 'vitest';
import { withFinalAnswer } from '../src/answer-extraction';
import { assignmentTable, calibrate, type LabelledBlock } from '../src/calibration';
import { emptyCassette, playerClient, recordingClient } from '../src/cassette';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest, JudgeResult } from '../src/contract';
import type { LoadedCriterion } from '../src/criteria';
import { createEscalation } from '../src/escalation';
import { judgePairwise, pairwiseRequest } from '../src/pairwise';
import { withReferenceConsensus } from '../src/reference';
import { withVerification } from '../src/verification';

const criterion = { name: 'correct', rubric: 'Correct answer.' };
const transcript = [{ role: 'user' as const, text: '2+2?' }];
const answer = (outcome: 'pass' | 'fail' | 'inconclusive'): JudgeResult => ({
  answer: { outcome, reasoning: outcome },
  raw: '',
  costUsd: 1,
});
function seat(id: string, family: string, vote: (r: JudgeRequest) => JudgeResult = () => answer('pass')) {
  const requests: JudgeRequest[] = [];
  const client: JudgeClient = {
    id,
    family,
    cls: 'system2',
    cost: 1,
    async judge(r) {
      requests.push(r);
      const result = vote(r);
      return r.candidates
        ? {
            ...result,
            winner:
              result.answer.outcome === 'pass'
                ? 'A'
                : result.answer.outcome === 'fail'
                  ? 'B'
                  : 'inconclusive',
          }
        : result;
    },
  };
  return { client, requests };
}
function escalation(first: JudgeClient, next: JudgeClient) {
  return createEscalation({
    first,
    // biome-ignore lint/suspicious/noThenProperty: escalation seats are a non-callable list.
    then: [next],
    agentFamily: 'meta',
    on: ['order-split', 'inconclusive'],
    decide: 'majority',
  });
}
const evidence = [{ expression: '2+2', claimed: 5, actual: 4, matches: false }];

describe('escalation wrapper composition', () => {
  it('keeps canonical presentation to one first-seat call without an order-split signal', async () => {
    const first = seat('first', 'anthropic', (r) => answer(r.candidates?.A === 'one' ? 'pass' : 'fail'));
    const next = seat('next', 'google');
    const result = await judgePairwise(
      escalation(first.client, next.client),
      criterion,
      transcript,
      'one',
      'two',
      { presentation: 'canonical' },
    );
    expect(result).toMatchObject({
      presentation: 'canonical',
      choice: 'first',
      calls: 1,
      costUsd: 1,
      escalation: { escalated: false, triggers: [] },
    });
    expect(result).not.toHaveProperty('ordered');
    expect(result).not.toHaveProperty('swapped');
    expect(result).not.toHaveProperty('positionBias');
    expect(first.requests).toHaveLength(1);
    expect(first.requests[0]?.presentation).toBe('canonical');
    expect(next.requests).toHaveLength(0);
  });

  it('replays a canonical escalation with its audit, cost and caller-relative choice', async () => {
    const first = seat('first', 'anthropic', () => answer('inconclusive'));
    const next = seat('next', 'google', () => answer('fail'));
    const cassette = emptyCassette();
    const client = recordingClient(escalation(first.client, next.client), cassette);
    const result = await judgePairwise(client, criterion, transcript, 'one', 'two', {
      presentation: 'canonical',
    });
    expect(result).toMatchObject({
      presentation: 'canonical',
      calls: 2,
      costUsd: 2,
      escalation: { escalated: true, triggers: ['inconclusive'] },
    });
    expect(first.requests).toHaveLength(1);
    expect(next.requests).toHaveLength(1);
    expect(cassette.entries).toHaveLength(1);
    const replay = await judgePairwise(
      playerClient(cassette, client.id),
      criterion,
      transcript,
      'two',
      'one',
      { presentation: 'canonical' },
    );
    expect(replay).toEqual({
      ...result,
      aIsFirst: !result.aIsFirst,
      choice: result.choice === 'first' ? 'second' : 'first',
    });
    expect(first.requests).toHaveLength(1);
    expect(next.requests).toHaveLength(1);
  });

  it.each(['YES', 'NO'] as const)(
    'routes both comparison orders once with checkability %s',
    async (checkability) => {
      const first = seat('first', 'anthropic', (r) => answer(r.candidates?.A === 'one' ? 'pass' : 'fail'));
      const next = seat('next', 'google');
      let checks = 0;
      let solves = 0;
      const client = withReferenceConsensus(
        createEscalation({
          first: first.client,
          // biome-ignore lint/suspicious/noThenProperty: escalation seats are a non-callable list.
          then: [next.client],
          agentFamily: 'meta',
          on: ['reference-disagreement'],
          decide: 'majority',
        }),
        {
          route: 'auto',
          samples: 1,
          async check(question) {
            expect(question).toBe('2+2?');
            checks += 1;
            return { answer: checkability, costUsd: 0.25 };
          },
          async solve(question) {
            expect(question).toBe('2+2?');
            solves += 1;
            return { answer: '4', costUsd: 0.5 };
          },
        },
      );
      const a = pairwiseRequest(criterion, transcript, 'one', 'two');
      const b = pairwiseRequest(criterion, transcript, 'two', 'one');
      const result = await client.judgeComparison?.(a, b);
      expect(checks).toBe(1);
      expect(solves).toBe(checkability === 'YES' ? 1 : 0);
      expect(first.requests.map((r) => r.reference)).toEqual(
        checkability === 'YES' ? ['4', '4'] : [undefined, undefined],
      );
      expect(next.requests).toHaveLength(0);
      expect(result).toMatchObject({
        costUsd: checkability === 'YES' ? 2.75 : 2.25,
        referenceAgreement: {
          attempts: checkability === 'YES' ? 1 : 0,
          agreement: checkability === 'YES' ? 1 : 0,
          used: checkability === 'YES',
          routed: checkability === 'YES',
        },
        escalation: { escalated: false, triggers: [] },
      });
      const second = await client.judgeComparison?.(a, b);
      expect(checks).toBe(1);
      expect(solves).toBe(checkability === 'YES' ? 2 : 0);
      expect(second?.costUsd).toBe(checkability === 'YES' ? 2.5 : 2);
    },
  );

  it.each(['first', 'outer'] as const)(
    'runs verification around %s without double escalation',
    async (position) => {
      const first = seat('first', 'anthropic');
      const next = seat('next', 'google', () => answer('fail'));
      const checked: JudgeRequest[] = [];
      const wrap = (client: JudgeClient) =>
        withVerification(client, {
          enabled: true,
          sandbox: {
            async verify(r) {
              checked.push(r);
              return evidence;
            },
          },
        });
      const client =
        position === 'first'
          ? escalation(wrap(first.client), next.client)
          : wrap(escalation(first.client, next.client));
      const result = await judgePairwise(client, criterion, transcript, 'one', 'two');
      expect(checked).toHaveLength(2);
      expect(first.requests).toHaveLength(2);
      expect(first.requests.every((r) => r.transcript.at(-1)?.tool === 'judge.arithmetic')).toBe(true);
      expect(next.requests).toHaveLength(1);
      expect(result).toMatchObject({ choice: 'second', calls: 3, costUsd: 3 });
      expect(next.requests[0]?.transcript.at(-1)?.tool).toBe(
        position === 'outer' ? 'judge.arithmetic' : undefined,
      );
    },
  );
  it.each(['throw', 'timeout'] as const)(
    'makes outer verification %s inconclusive without judging',
    async (failure) => {
      const first = seat('first', 'anthropic');
      const next = seat('next', 'google');
      const client = withVerification(escalation(first.client, next.client), {
        enabled: true,
        timeoutMs: 5,
        sandbox: {
          verify: async () => {
            if (failure === 'throw') throw new Error('offline');
            return new Promise(() => {});
          },
        },
      });
      expect(await judgePairwise(client, criterion, transcript, 'one', 'two')).toMatchObject({
        choice: 'tie',
        ordered: 'inconclusive',
        swapped: 'inconclusive',
        positionBias: false,
      });
      expect(first.requests).toHaveLength(0);
      expect(next.requests).toHaveLength(0);
    },
  );
  it('does not add comparison support to ordinary clients or run a disabled sandbox', async () => {
    const first = seat('first', 'anthropic');
    const next = seat('next', 'google');
    const options = {
      sandbox: {
        async verify() {
          throw new Error('disabled sandbox');
        },
      },
    };
    expect(withVerification(first.client, options).judgeComparison).toBeUndefined();
    expect(withFinalAnswer(first.client).judgeComparison).toBeUndefined();
    expect(
      withReferenceConsensus(first.client, {
        async solve() {
          return {};
        },
      }).judgeComparison,
    ).toBeUndefined();
    await judgePairwise(
      withVerification(escalation(first.client, next.client), options),
      criterion,
      transcript,
      'one',
      'two',
    );
    expect(first.requests).toHaveLength(2);
  });
  it('blocks judging when only the swapped sandbox fails', async () => {
    const first = seat('first', 'anthropic');
    const next = seat('next', 'google');
    const checked: string[] = [];
    const client = withVerification(escalation(first.client, next.client), {
      enabled: true,
      sandbox: {
        async verify(r) {
          checked.push(r.candidates?.A ?? '');
          if (r.candidates?.A === 'two') throw new Error('swapped failure');
          return evidence;
        },
      },
    });
    const result = await judgePairwise(client, criterion, transcript, 'one', 'two');
    expect(result.choice).toBe('tie');
    expect(checked).toEqual(['one', 'two']);
    expect(first.requests).toHaveLength(0);
    expect(next.requests).toHaveLength(0);
  });
  it('propagates comparison transport failures after preprocessing', async () => {
    const first = seat('first', 'anthropic').client;
    const failing: JudgeClient = {
      ...first,
      async judgeComparison() {
        throw new Error('transport');
      },
    };
    const client = withFinalAnswer(
      withReferenceConsensus(
        withVerification(failing, {
          enabled: true,
          sandbox: {
            async verify() {
              return [];
            },
          },
        }),
        {
          samples: 2,
          async solve() {
            return { answer: '4' };
          },
        },
      ),
    );
    const a = pairwiseRequest(criterion, transcript, 'one', 'two');
    await expect(client.judgeComparison?.(a, a)).rejects.toThrow('transport');
  });
  it('preserves every request field and transforms each order before a single comparison call', async () => {
    const pairs: JudgeRequest[][] = [];
    const base = seat('comparison', 'anthropic').client;
    const comparison: JudgeClient = {
      ...base,
      async judgeComparison(a, b) {
        pairs.push([a, b]);
        return {
          ...answer('pass'),
          comparison: { ordered: 'pass', swapped: 'fail', consistent: true, positionBias: false },
        };
      },
    };
    const client = withFinalAnswer(
      withVerification(comparison, {
        enabled: true,
        sandbox: {
          async verify() {
            return evidence;
          },
        },
      }),
    );
    const full: JudgeRequest = {
      ...pairwiseRequest(
        criterion,
        [...transcript, { role: 'agent', text: 'Final answer: 4' }],
        'one',
        'two',
      ),
      artifact: 'ordered',
      inputs: [{ path: 'x', text: 'source' }],
      given: { stage: 'start' },
      requirements: [{ id: 'x', requirement: 'check' }],
      reference: '4',
      budget: 'large',
      answerContract: 'legacy',
    };
    const swapped = { ...full, artifact: 'swapped', candidates: { A: 'two', B: 'one' } };
    await client.judgeComparison?.(full, swapped);
    expect(pairs).toHaveLength(1);
    for (const [i, original] of [full, swapped].entries()) {
      const got = pairs[0]?.[i];
      expect(got).toMatchObject({ ...original, transcript: expect.any(Array) });
      expect(got?.transcript.slice(0, original.transcript.length)).toEqual(original.transcript);
      expect(got?.transcript.slice(-2).map((e) => e.tool)).toEqual([
        'judge.final_answer',
        'judge.arithmetic',
      ]);
    }
    expect(full.transcript).toHaveLength(4);
  });
  it.each(['first', 'outer'] as const)(
    'runs blind reference solves around %s and accounts for all costs',
    async (position) => {
      const first = seat('first', 'anthropic');
      const next = seat('next', 'google', () => answer('fail'));
      const questions: string[] = [];
      const wrap = (client: JudgeClient) =>
        withReferenceConsensus(client, {
          samples: 2,
          async solve(q) {
            questions.push(q);
            return { answer: '4', costUsd: 0.25 };
          },
        });
      const client =
        position === 'first'
          ? escalation(wrap(first.client), next.client)
          : wrap(escalation(first.client, next.client));
      const result = await judgePairwise(client, criterion, transcript, 'one', 'two');
      expect(questions).toEqual(Array(position === 'first' ? 4 : 2).fill('2+2?'));
      expect(first.requests.map((r) => r.reference)).toEqual(['4', '4']);
      expect(next.requests).toHaveLength(1);
      expect(result).toMatchObject({ choice: 'second', calls: 3, costUsd: position === 'first' ? 4 : 3.5 });
    },
  );
  it('routes failed outer reference consensus before escalation and counts failed attempts', async () => {
    const first = seat('first', 'anthropic', (r) => answer(r.candidates?.A === 'one' ? 'pass' : 'fail'));
    const next = seat('next', 'google', () => answer('fail'));
    const inner = createEscalation({
      first: first.client,
      // biome-ignore lint/suspicious/noThenProperty: escalation seats are a non-callable list.
      then: [next.client],
      agentFamily: 'meta',
      on: ['reference-disagreement'],
      decide: 'majority',
    });
    let solves = 0;
    const client = withReferenceConsensus(inner, {
      samples: 3,
      async solve(_q, attempt) {
        solves += 1;
        if (attempt === 2) throw new Error('missing solve');
        return { answer: String(attempt), costUsd: 0.25 };
      },
    });
    const a = pairwiseRequest(criterion, transcript, 'one', 'two');
    const b = pairwiseRequest(criterion, transcript, 'two', 'one');
    const result = await client.judgeComparison?.(a, b);
    expect(solves).toBe(3);
    expect(first.requests.every((r) => r.referenceDisagreement === true)).toBe(true);
    expect(next.requests).toHaveLength(1);
    expect(result).toMatchObject({
      costUsd: 3.5,
      referenceAgreement: { attempts: 3, agreement: 1 / 3, used: false },
      escalation: { triggers: ['reference-disagreement'] },
    });
  });
  it('solves distinct comparison questions separately and preserves a prior disagreement', async () => {
    const first = seat('first', 'anthropic');
    const next = seat('next', 'google');
    const questions: string[] = [];
    const client = withReferenceConsensus(escalation(first.client, next.client), {
      samples: 2,
      async solve(q) {
        questions.push(q);
        return { answer: q, costUsd: 0.25 };
      },
    });
    const a = { ...pairwiseRequest(criterion, transcript, 'one', 'two'), referenceDisagreement: true };
    const b = pairwiseRequest(criterion, [{ role: 'user', text: 'other question' }], 'two', 'one');
    const result = await client.judgeComparison?.(a, b);
    expect(questions).toEqual(['2+2?', '2+2?', 'other question', 'other question']);
    expect(first.requests.map((r) => r.reference)).toEqual(['2+2?', 'other question']);
    expect(first.requests[0]?.referenceDisagreement).toBe(true);
    expect(result).toMatchObject({
      costUsd: 4,
      referenceAgreement: { attempts: 4, agreement: 1, used: true },
    });
  });
  it('preserves explicit references independently and keeps concurrent solves request local', async () => {
    const first = seat('first', 'anthropic');
    const next = seat('next', 'google');
    const questions: string[] = [];
    const client = withReferenceConsensus(escalation(first.client, next.client), {
      samples: 2,
      async solve(q) {
        questions.push(q);
        await Promise.resolve();
        return { answer: q, costUsd: 0.25 };
      },
    });
    const run = (q: string) => {
      const a = {
        ...pairwiseRequest(criterion, [{ role: 'user' as const, text: q }], 'one', 'two'),
        reference: 'caller',
      };
      const b = pairwiseRequest(criterion, [{ role: 'user' as const, text: q }], 'two', 'one');
      return client.judgeComparison?.(a, b);
    };
    const results = await Promise.all([run('question 1'), run('question 2')]);
    expect(questions.sort()).toEqual(['question 1', 'question 1', 'question 2', 'question 2']);
    expect(results.map((r) => r?.costUsd)).toEqual([3.5, 3.5]);
    expect(
      first.requests
        .filter((r) => r.reference !== 'caller')
        .map((r) => r.reference)
        .sort(),
    ).toEqual(['question 1', 'question 2']);
  });
});

const fixtures = {
  pass: { transcript: [{ role: 'agent' as const, text: 'pass' }] },
  fail: { transcript: [{ role: 'agent' as const, text: 'fail' }] },
};
const loaded: LoadedCriterion = { path: 'fixture', def: criterion, fixtures };
const labels = new Map<string, LabelledBlock[]>([
  [
    'correct',
    [
      { id: 'p', label: 'pass', transcript: fixtures.pass.transcript },
      { id: 'f', label: 'fail', transcript: fixtures.fail.transcript },
    ],
  ],
]);
function calibrated(id: string, family: string, families?: readonly string[]): JudgeClient {
  return {
    ...seat(id, family, (r) => answer(r.transcript[0]?.text === 'pass' ? 'pass' : 'fail')).client,
    ...(families ? { families } : {}),
  };
}
describe('calibration constituent families', () => {
  it('excludes composite clients and model aliases sharing the agent family before calls', async () => {
    const composite = calibrated('composite', 'escalation', ['claude-sonnet', 'gemini-pro']);
    const alias = calibrated('alias', 'anthropic/claude-sonnet');
    const report = await calibrate({
      judges: [composite, alias],
      agentFamily: 'Claude-opus',
      criteria: [loaded],
      labels,
      repeats: 1,
      mode: 'llm',
    });
    expect(report.excluded).toEqual(['composite', 'alias']);
    expect(report.spentUsd).toBe(0);
  });
  it.each(['cheapest', 'council'] as const)(
    'does not mark a cross-family composite single_family with %s assignment',
    async (rule) => {
      const judges = [0, 1, 2].map((i) => calibrated(`c${i}`, 'escalation', ['anthropic', 'google']));
      const report = await calibrate({
        judges,
        criteria: [loaded],
        labels,
        repeats: 1,
        mode: 'llm',
        ...(rule === 'cheapest' ? { rule } : {}),
      });
      expect(report.criteria[0]?.assignment.status).toBe('assigned');
      expect(assignmentTable(report).criteria[0]).not.toHaveProperty('single_family');
    },
  );
  it.each(['cheapest', 'council'] as const)(
    'normalizes aliases for %s single_family reporting',
    async (rule) => {
      const judges = ['Anthropic', 'claude-sonnet', 'anthropic/claude-opus'].map((f, i) =>
        calibrated(`c${i}`, f),
      );
      const report = await calibrate({
        judges,
        criteria: [loaded],
        labels,
        repeats: 1,
        mode: 'llm',
        ...(rule === 'cheapest' ? { rule } : {}),
      });
      expect(assignmentTable(report).criteria[0]).toMatchObject({ single_family: 'anthropic' });
    },
  );
});
