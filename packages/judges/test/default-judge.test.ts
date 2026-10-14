import { describe, expect, it } from 'vitest';
import { emptyCassette, playerClient, recordingClient, requestKey } from '../src/cassette';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { createDefaultJudge } from '../src/default-judge';

function mock(outputs: unknown[]) {
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
  return { calls, judge: createDefaultJudge({ provider: 'claude-cli', model: 'test', transport }) };
}

describe('one default configuration', () => {
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
      async complete() {
        calls++;
        return {
          text: '{"checks":[{"id":"x","reasoning":"absent","evidence":null,"met":false}]}',
          raw: '',
          dialect: 'scratchpad-json',
          fingerprint: 'test',
          costUsd: 0.08,
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
    expect(calls).toBe(1);
    expect(second.answer.outcome).toBe('inconclusive');
    expect(spendLedger.spentUsd).toBe(0.08);
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
    ]);
    const result = await judge.judge({
      criterion: { name: 'x', rubric: 'Address every part of the latest request.' },
      transcript: '[user] Name and price? [agent] The name is Widget.',
    });
    expect(result.answer.outcome).toBe('fail');
    expect(calls[0]?.user).toContain('Name and price?');
    expect(calls[0]?.user).not.toContain('The name is Widget');
    expect(calls[1]?.system).toContain('Extract each distinct requested part');
    expect(result.costUsd).toBeCloseTo(0.02);
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
