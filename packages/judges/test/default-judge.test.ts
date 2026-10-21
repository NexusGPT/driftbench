import { describe, expect, it } from 'vitest';
import { emptyCassette, playerClient, recordingClient, requestKey } from '../src/cassette';
import { ClaudeThinkingError } from '../src/clients/claude-cli';
import { ClaudeTransportError } from '../src/clients/claude-errors';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { createDefaultJudge, DEFAULT_JUDGE_POLICY } from '../src/default-judge';

function mock(
  outputs: unknown[],
  policyOverride?: { lengthPreference?: boolean; conversationTurns?: boolean },
) {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'test',
    async complete(request) {
      calls.push(request);
      const value = outputs.shift();
      if (value === undefined) throw new Error('unexpected call');
      return {
        text: JSON.stringify(value),
        raw: JSON.stringify(value),
        dialect: 'scratchpad-json',
        fingerprint: 'test',
        costUsd: 0.01,
      };
    },
  };
  return {
    calls,
    judge: createDefaultJudge({
      provider: 'claude-cli',
      model: 'test',
      transport,
      ...(policyOverride ? { policyOverride } : {}),
    }),
  };
}

describe('one default configuration', () => {
  it('evaluates the full pair criterion before an arithmetic answer can decide', async () => {
    const rubric = 'An invalid equality disqualifies a reply even when its final answer is correct.';
    const ledger = (reverse: boolean) => ({
      items: ['final_correct', 'format_followed', 'derivation_sound', 'caller_criterion'].map((name) => ({
        name,
        first: name === 'caller_criterion' ? (reverse ? 4 : 0) : 2,
        second: name === 'caller_criterion' ? (reverse ? 0 : 4) : 2,
        reasoning: 'The full criterion disqualifies the invalid equality.',
        evidence: null,
      })),
    });
    const { judge, calls } = mock([{ route: 'objective' }, ledger(false), ledger(true)]);
    const result = await judge.judge({
      criterion: { name: 'math', rubric },
      transcript: [{ role: 'user', text: 'What is 2+2?' }],
      candidates: { A: '2+2=9\nFinal answer: 4', B: '2+2=4\nFinal answer: 5' },
    });
    expect(result.winner).toBe('B');
    expect(calls).toHaveLength(3);
    expect(calls.slice(1).every((call) => call.user.includes(rubric))).toBe(true);
    expect(JSON.parse(result.raw).reads).toHaveLength(2);
  });

  it.each([
    [true, false, 'fail'],
    [false, true, 'fail'],
    [null, true, 'inconclusive'],
    [true, null, 'inconclusive'],
    [true, true, 'pass'],
    [false, null, 'fail'],
  ] as const)('composes relevance %s and the full criterion %s as %s', async (relevant, meets, outcome) => {
    const { judge, calls } = mock([
      { route: 'relevance' },
      {
        checks: [
          {
            obligation: 'name',
            requestQuote: 'Name?',
            reasoning: 'name check',
            answerQuote: 'Widget',
            met: relevant,
          },
        ],
      },
      {
        checks: [
          {
            id: 'x',
            reasoning: 'original criterion',
            evidence: [{ source: 'transcript.1', quote: 'Widget' }],
            met: meets,
          },
        ],
      },
    ]);
    const request = {
      criterion: { name: 'x', rubric: 'Address the request and apply CRITERION_SENTINEL.' },
      transcript: [
        { role: 'user' as const, text: 'Name?' },
        { role: 'agent' as const, text: 'Widget' },
      ],
    };
    const cassette = emptyCassette();
    const result = await recordingClient(judge, cassette).judge(request);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.user).toContain('CRITERION_SENTINEL');
    expect(result.answer.outcome).toBe(outcome);
    expect(result.costUsd).toBeCloseTo(0.03);
    expect(result.requestCount).toBe(3);
    expect(JSON.parse(result.raw)).toMatchObject({
      relevance: { responseRelevance: expect.any(Object) },
      criterion: { checks: expect.any(Array) },
    });
    expect(await playerClient(cassette, judge.id).judge(request)).toEqual(result);
  });

  it('keeps explicitly selected response relevance as one assessment', async () => {
    const { judge, calls } = mock([
      {
        checks: [
          {
            obligation: 'name',
            requestQuote: 'Name?',
            reasoning: 'answered',
            answerQuote: 'Widget',
            met: true,
          },
        ],
      },
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address request.' },
      assessment: { kind: 'response-relevance' },
      transcript: [
        { role: 'user', text: 'Name?' },
        { role: 'agent', text: 'Widget' },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(result.answer.outcome).toBe('pass');
  });

  it.each([
    ['relevance', true, 'inconclusive'],
    ['criterion', true, 'inconclusive'],
    ['relevance', false, 'fail'],
    ['criterion', false, 'fail'],
  ] as const)('keeps a malformed %s from becoming a pass', async (malformed, met, outcome) => {
    const relevance = {
      checks: [
        { obligation: 'name', requestQuote: 'Name?', reasoning: 'checked', answerQuote: 'Widget', met },
      ],
    };
    const criterion = {
      checks: [
        { id: 'x', reasoning: 'checked', evidence: [{ source: 'transcript.1', quote: 'Widget' }], met },
      ],
    };
    const { judge } = mock([
      { route: 'relevance' },
      malformed === 'relevance' ? { malformed: true } : relevance,
      malformed === 'criterion' ? { malformed: true } : criterion,
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address the request.' },
      transcript: [
        { role: 'user', text: 'Name?' },
        { role: 'agent', text: 'Widget' },
      ],
    });
    expect(result.answer.outcome).toBe(outcome);
    expect(result.unparsed === true).toBe(outcome === 'inconclusive');
  });

  it('retains a failed relevance receipt while completing the full criterion within the cap', async () => {
    let count = 0;
    const error = new ClaudeTransportError('http', 'failed', {
      stdout: 'RELEVANCE_FAILURE_SENTINEL',
      code: 1,
    });
    Object.assign(error, { costUsd: 0.03, requestCount: 3 });
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'part-failure',
      async complete() {
        if (++count === 2) throw error;
        const text =
          count === 1
            ? '{"route":"relevance"}'
            : '{"checks":[{"id":"x","reasoning":"missing","evidence":null,"met":false}]}';
        return { text, raw: text, dialect: 'scratchpad-json', fingerprint: 'part-failure', costUsd: 0.01 };
      },
    };
    const judge = createDefaultJudge({
      provider: 'claude-cli',
      transport,
      maxBudgetUsd: 0.1,
      spendCapUsd: 0.2,
    });
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address the request.' },
      transcript: [
        { role: 'user', text: 'Name?' },
        { role: 'agent', text: 'Widget' },
      ],
    });
    expect(result.answer.outcome).toBe('fail');
    expect(result.unparsed).not.toBe(true);
    expect(result.costUsd).toBeCloseTo(0.05);
    expect(result.requestCount).toBe(5);
    expect(result.raw).toContain('RELEVANCE_FAILURE_SENTINEL');
    expect(count).toBe(3);
  });

  it.each(['transport', 'thinking'] as const)(
    'retains native evidence from a thrown %s failure',
    async (kind) => {
      const retryReceipts = [
        { raw: 'RETRY_RECEIPT_SENTINEL', exitCode: 1, category: 'overload' as const, costUsd: 0.01 },
      ];
      const recovery = {
        reason: 'reasoning-budget-exhausted' as const,
        requestCount: 2,
        attempts: [{ raw: 'THINKING_RECEIPT_SENTINEL', usage: {}, costUsd: 0.02 }],
      };
      const error =
        kind === 'transport'
          ? new ClaudeTransportError('http', 'failed', { stdout: 'FINAL_RECEIPT_SENTINEL', code: 1 })
          : new ClaudeThinkingError(recovery, {}, 0.03);
      Object.assign(error, { costUsd: 0.03, requestCount: 3, retryReceipts });
      const transport: DialectTransport = {
        dialect: 'scratchpad-json',
        fingerprint: 'failed',
        async complete() {
          throw error;
        },
      };
      const judge = createDefaultJudge({ provider: 'claude-cli', transport });
      const result = await judge.judge({
        criterion: { name: 'x', rubric: 'x' },
        system: 'explicit',
        transcript: [],
      });
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.costUsd).toBe(0.03);
      expect(result.requestCount).toBe(3);
      expect(result.retryReceipts).toEqual(retryReceipts);
      expect(result.raw).toContain(
        kind === 'transport' ? 'FINAL_RECEIPT_SENTINEL' : 'THINKING_RECEIPT_SENTINEL',
      );
      if (kind === 'thinking') expect(result.thinkingRecovery).toEqual(recovery);
    },
  );
  it('keys explicit reasoning separately and names configured models separately', () => {
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete() {
        throw new Error('not called');
      },
    };
    const a = createDefaultJudge({ provider: 'openai', model: 'one', env: {}, transport });
    const b = createDefaultJudge({ provider: 'openai', model: 'two', env: {}, transport });
    expect(a.id).not.toBe(b.id);
    const request = { criterion: { name: 'x', rubric: 'x' }, transcript: [] };
    expect(requestKey({ ...request, reasoning: 'low' }, a)).not.toBe(
      requestKey({ ...request, reasoning: 'high' }, a),
    );
  });
  it('shares reservations and spend across separately configured clients', async () => {
    let calls = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete(input) {
        calls++;
        return {
          text: '{"checks":[{"id":"x","reasoning":"absent","evidence":null,"met":false}]}',
          raw: '',
          dialect: 'scratchpad-json',
          fingerprint: 'test',
          costUsd: Math.min(0.08, input.maxBudgetUsd ?? 0.08),
        };
      },
    };
    const spendLedger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
    const options = {
      provider: 'claude-cli' as const,
      model: 'test',
      transport,
      spendLedger,
      maxBudgetUsd: 0.1,
      spendCapUsd: 0.15,
    };
    const request = { criterion: { name: 'x', rubric: 'x' }, transcript: [], system: 'caller policy' };
    await createDefaultJudge(options).judge(request);
    const second = await createDefaultJudge(options).judge(request);
    expect(second.answer.outcome).toBe('fail');
    const third = await createDefaultJudge(options).judge(request);
    expect(calls).toBe(2);
    expect(third.answer.outcome).toBe('inconclusive');
    expect(spendLedger.spentUsd).toBeCloseTo(0.15);
    expect(spendLedger.reservedUsd).toBe(0);
  });
  it('reuses routing only for identical criteria and question data', async () => {
    const answer = { checks: [{ id: 'x', reasoning: 'absent', evidence: null, met: false }] };
    const { judge, calls } = mock([{ route: 'criterion' }, answer, answer]);
    const criterion = { name: 'x', rubric: 'Require reply.' };
    await judge.judge({ criterion, transcript: [{ role: 'agent', text: 'a' }] });
    const repeat = await judge.judge({ criterion, transcript: [{ role: 'agent', text: 'b' }] });
    expect(calls).toHaveLength(3);
    expect(repeat.requestCount).toBe(1);
  });
  it('records and replays the complete routed procedure without parsing its audit as a ledger', async () => {
    const { judge } = mock([
      { route: 'criterion' },
      {
        checks: [
          {
            id: 'x',
            reasoning: 'met',
            evidence: [{ source: 'transcript.0', quote: 'literal reply' }],
            met: true,
          },
        ],
      },
    ]);
    const request = {
      criterion: { name: 'x', rubric: 'Require reply.' },
      transcript: [{ role: 'agent' as const, text: 'literal reply' }],
    };
    const cassette = emptyCassette();
    const original = await recordingClient(judge, cassette).judge(request);
    const replay = await playerClient(cassette, judge.id).judge(request);
    expect(replay).toEqual(original);
    expect(replay.defaultJudge?.route).toBe('criterion');
  });
  it('keeps the conversation scope and pass/fail definitions in an ordinary evaluation', async () => {
    const { judge, calls } = mock([
      { route: 'relevance' },
      { checks: [{ id: 'x', reasoning: 'earlier omission', evidence: null, met: false }] },
    ]);
    await judge.judge({
      criterion: {
        name: 'x',
        rubric: 'Address every request.',
        scope: 'conversation',
        pass: 'All turns answer.',
        fail: 'Any ignored turn.',
      },
      transcript: [
        { role: 'user', text: 'Question' },
        { role: 'agent', text: 'Answer' },
      ],
    });
    expect(calls[1]?.user).toContain('All turns answer.');
    expect(calls[1]?.user).toContain('Any ignored turn.');
  });
  it('retains explicit caller requirement ids even when candidates exist', async () => {
    const { judge, calls } = mock([
      { checks: [{ id: 'custom-id', reasoning: 'missing', evidence: null, met: false }] },
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Task' },
      requirements: [{ id: 'custom-id', requirement: 'Cite the source.' }],
      candidates: { A: 'a', B: 'b' },
      transcript: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.user).toContain('custom-id');
    expect(result.checks?.[0]?.id).toBe('custom-id');
  });
  it('refuses another call when unknown cost or reservations exhaust the cap', async () => {
    let calls = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete() {
        calls++;
        return { text: '{"route":"criterion"}', raw: '', dialect: 'scratchpad-json', fingerprint: 'test' };
      },
    };
    const judge = createDefaultJudge({
      provider: 'claude-cli',
      model: 'test',
      transport,
      maxBudgetUsd: 0.1,
      spendCapUsd: 1,
    });
    const result = await judge.judge({ criterion: { name: 'x', rubric: 'x' }, transcript: [] });
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.costIncomplete).toBe(true);
    expect(calls).toBe(1);
  });
  it('normalizes before routing and chooses the relevance obligation ledger', async () => {
    const { judge, calls } = mock([
      { route: 'relevance' },
      {
        checks: [
          {
            obligation: 'name',
            requestQuote: 'Name and price?',
            reasoning: 'price absent',
            answerQuote: null,
            met: false,
          },
        ],
      },
      { checks: [{ id: 'x', reasoning: 'price absent', evidence: null, met: false }] },
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address every part of the latest request.' },
      transcript: '[user] Name and price? [agent] The name is Widget.',
    });
    expect(result.answer.outcome).toBe('fail');
    expect(calls[0]?.user).toContain('Name and price?');
    expect(calls[0]?.user).not.toContain('The name is Widget');
    expect(calls[1]?.system).toContain('Extract each distinct requested part');
    expect(result.costUsd).toBeCloseTo(0.03);
  });
  it('uses prompt and decoder two for an ordinary criterion, and preserves evidence', async () => {
    const { judge, calls } = mock([
      { route: 'criterion' },
      {
        checks: [
          {
            id: 'x',
            reasoning: 'matches',
            evidence: [{ source: 'input/catalog', quote: 'sku 8' }],
            met: true,
          },
        ],
      },
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Matches catalog.' },
      transcript: [{ role: 'agent', text: 'sku 8' }],
      inputs: [{ path: 'catalog', text: 'sku 8' }],
    });
    expect(result.answer.outcome).toBe('pass');
    expect(calls[1]?.system).toContain('Compare each named identifier');
  });
  it('preserves custom systems and explicit versions without a routing call', async () => {
    const { judge, calls } = mock([
      {
        checks: [
          {
            id: 'x',
            reasoning: '',
            evidence: [{ source: 'transcript.0', quote: 'literal reply' }],
            met: true,
          },
        ],
      },
    ]);
    await judge.judge({
      criterion: { name: 'x', rubric: 'x' },
      transcript: [{ role: 'agent', text: 'literal reply' }],
      system: 'Custom policy',
      criterionPromptVersion: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe('Custom policy');
  });
  it('does not let a relevance route discard an input or artifact', async () => {
    const { judge, calls } = mock([
      { route: 'relevance' },
      { checks: [{ id: 'x', reasoning: 'missing', evidence: null, met: false }] },
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address request using artifact.' },
      transcript: [
        { role: 'user', text: 'Compare file.' },
        { role: 'agent', text: 'Okay.' },
      ],
      artifact: 'source file',
    });
    expect(result.answer.outcome).toBe('fail');
    expect(calls[1]?.user).toContain('source file');
  });
  it('treats malformed routing as ordinary criterion evaluation, never a pass', async () => {
    const { judge, calls } = mock([
      { route: 'unknown' },
      { checks: [{ id: 'x', reasoning: 'missing', evidence: null, met: false }] },
    ]);
    expect(
      (await judge.judge({ criterion: { name: 'x', rubric: 'Require answer.' }, transcript: [] })).answer
        .outcome,
    ).toBe('fail');
    expect(calls).toHaveLength(2);
  });
  it('uses both pair orders and preserves caller rubric rows', async () => {
    const ledger = (first: number, second: number) => ({
      items: [{ name: 'accuracy', first, second, reasoning: 'facts', evidence: null }],
    });
    const { judge, calls } = mock([ledger(4, 0), ledger(0, 4)]);
    const result = await judge.judgePair?.({
      criterion: { name: 'x', rubric: 'Accuracy.' },
      assessment: { kind: 'pairwise', items: [{ name: 'accuracy', rubric: 'Accuracy.', hard: true }] },
      candidates: { A: 'Right answer.', B: 'Wrong answer.' },
      transcript: [{ role: 'user', text: 'A question.' }],
    });
    expect(result?.winner).toBe('A');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.user.indexOf('Wrong answer.')).toBeLessThan(
      calls[1]?.user.indexOf('Right answer.') ?? -1,
    );
  });
  it('does not recover a blocked pair ledger by parsing its raw JSON again', async () => {
    let count = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'blocked',
      async complete() {
        count++;
        return {
          text: '{"items":[{"name":"x","first":4,"second":0,"reasoning":"ok","evidence":null}]}',
          raw: 'blocked provider output',
          refusal: 'blocked',
          dialect: 'scratchpad-json',
          fingerprint: 'blocked',
          costUsd: 0.01,
        };
      },
    };
    const judge = createDefaultJudge({ provider: 'claude-cli', model: 'test', transport });
    const result = await judge.judgePair?.({
      criterion: { name: 'x', rubric: 'x' },
      assessment: { kind: 'pairwise', items: [{ name: 'x', rubric: 'x' }] },
      candidates: { A: 'a', B: 'b' },
      transcript: [],
    });
    expect(result?.winner).toBe('inconclusive');
    expect(result?.defaultJudge?.receipts).toHaveLength(count);
    expect(result?.costUsd).toBeCloseTo(count * 0.01);
  });
  it('includes thrown transport charges and retries in the outer procedure total', async () => {
    let count = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'failed',
      async complete() {
        if (++count === 1)
          return {
            text: '{"route":"criterion"}',
            raw: '',
            dialect: 'scratchpad-json',
            fingerprint: 'failed',
            costUsd: 0.01,
          };
        throw Object.assign(new Error('failed'), { costUsd: 0.03, requestCount: 3 });
      },
    };
    const judge = createDefaultJudge({ provider: 'claude-cli', model: 'test', transport });
    const result = await judge.judge({ criterion: { name: 'x', rubric: 'x' }, transcript: [] });
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.costUsd).toBeCloseTo(0.04);
    expect(result.requestCount).toBe(4);
  });
});

describe('default-on-v8: a conversation criterion is judged turn by turn', () => {
  const met = (value: boolean) => ({ checks: [{ id: 'x', reasoning: 'r', evidence: null, met: value }] });
  const request = {
    criterion: { name: 'x', rubric: 'Address every request.', scope: 'conversation' as const },
    transcript: [
      { role: 'user' as const, text: 'First question' },
      { role: 'agent' as const, text: 'First answer' },
      { role: 'user' as const, text: 'Second question' },
      { role: 'agent' as const, text: 'Second answer' },
    ],
  };
  it('is part of the frozen policy', () => {
    expect(DEFAULT_JUDGE_POLICY).toMatchObject({ version: 'default-on-v8', conversationTurns: false });
  });
  it('judges each customer turn on its own prefix and fails on the turn that fails', async () => {
    const { judge, calls } = mock([{ route: 'criterion' }, met(true), met(false)], {
      conversationTurns: true,
    });
    const result = await judge.judge(request);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.user).not.toContain('Second question');
    expect(calls[2]?.user).toContain('Second question');
    expect(result.answer.outcome).toBe('fail');
    expect(result.answer.reasoning).toContain('Turn 2 fails');
    expect(result.defaultJudge?.route).toBe('criterion');
  });
  it('passes only when every turn passes', async () => {
    const { judge } = mock([{ route: 'criterion' }, met(true), met(true)], { conversationTurns: true });
    expect((await judge.judge(request)).answer.outcome).toBe('pass');
  });
  it('judges the whole conversation in one call by default, and the field changes the settings hash', async () => {
    const on = mock([], { conversationTurns: true }).judge;
    const off = mock([{ route: 'criterion' }, met(true)]);
    const result = await off.judge.judge(request);
    expect(off.calls).toHaveLength(2);
    expect(result.answer.outcome).toBe('pass');
    expect(off.judge.settings).not.toBe(on.settings);
  });
  it('leaves a single-turn conversation criterion on the plain route', async () => {
    const { judge, calls } = mock(
      [
        { route: 'criterion' },
        {
          checks: [
            {
              id: 'x',
              reasoning: 'r',
              evidence: [{ source: 'transcript.1', quote: 'First answer' }],
              met: true,
            },
          ],
        },
      ],
      { conversationTurns: true },
    );
    const result = await judge.judge({ ...request, transcript: request.transcript.slice(0, 2) });
    expect(calls).toHaveLength(2);
    expect(result.answer.outcome).toBe('pass');
    expect(result.answer.reasoning).toBe('Address every request.: r');
  });
});

describe('default-on-v8: the settings hash', () => {
  it('is the same with the fields at their defaults, and changes when one is switched on', () => {
    const plain = mock([]).judge.settings;
    // The hash default-on-v7 gave this same client (provider claude-cli, model test, transport fingerprint test),
    // computed on the release/next code before this change.
    expect(plain).toBe('2989b6cda5a8');
    expect(mock([], { conversationTurns: false, lengthPreference: false }).judge.settings).toBe(plain);
    expect(mock([], { conversationTurns: true }).judge.settings).not.toBe(plain);
    expect(mock([], { lengthPreference: true }).judge.settings).not.toBe(plain);
    expect(mock([], { lengthPreference: true }).judge.settings).not.toBe(
      mock([], { conversationTurns: true }).judge.settings,
    );
  });
});
