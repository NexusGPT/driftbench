import { describe, expect, it } from 'vitest';
import type { DialectCompletion, DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import type { JudgeRequest } from '../src/contract';
import { verifyAnswer } from '../src/verify-answer';

const request = (response = 'Final answer: 4', question = 'What is 2 + 2?'): JudgeRequest => ({
  criterion: { name: 'correct', rubric: 'The final answer is correct.' },
  transcript: [
    { role: 'user', text: question },
    { role: 'agent', text: response },
  ],
});
function transport(outputs: readonly (string | Partial<DialectCompletion> | Error)[]) {
  const seen: DialectCompletionRequest[] = [];
  const client: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'test',
    async complete(input) {
      seen.push(input);
      const output = outputs[seen.length - 1];
      if (output instanceof Error) throw output;
      if (output === undefined) throw new Error('unexpected call');
      return {
        dialect: 'scratchpad-json',
        fingerprint: 'test',
        raw: typeof output === 'string' ? output : 'provider raw',
        text: '',
        costUsd: 0.01,
        ...(typeof output === 'string' ? { text: output } : output),
      };
    },
  };
  return { client, seen };
}
const solves = (answer = '4') => Array.from({ length: 3 }, () => `Working.\nFinal answer: ${answer}`);
const pass = '{"pass":true,"reason":"The submitted answer meets the criterion."}';

describe('product answer verification', () => {
  it('settles explicit option letters in code but still checks the complete criterion', async () => {
    const { client, seen } = transport([
      'Final answer: (A) Rowan',
      'Final answer: A. Rowan',
      'Final answer: [A] Rowan',
      '{"pass":false,"reason":"The submitted option is C, not A."}',
    ]);
    const result = await verifyAnswer(client, request('Final answer is: (C) Quinn', 'Choose A or C.'));
    expect(result.answer.outcome).toBe('fail');
    expect(seen).toHaveLength(4);
    expect(seen.at(-1)?.user).toContain('false,false,false');
    expect(JSON.parse(result.raw).extraction).toBe('literal');
  });
  it('keeps the full criterion after all three option letters agree', async () => {
    const { client, seen } = transport([
      ...solves('(C) Quinn'),
      '{"pass":false,"reason":"The required explanation is missing."}',
    ]);
    const input: JudgeRequest = {
      ...request('Final answer: (C) Quinn', 'Choose A or C and explain.'),
      criterion: { name: 'complete', rubric: 'Correct option and explanation are both required.' },
    };
    expect((await verifyAnswer(client, input)).answer.outcome).toBe('fail');
    expect(seen).toHaveLength(4);
    expect(seen.at(-1)?.user).toContain('true,true,true');
    expect(seen.at(-1)?.system).toContain('Correct option and explanation are both required.');
  });
  it('does not interpret prose beginning with A as an option marker', async () => {
    const { client, seen } = transport([
      ...solves('A different animal'),
      '{"same":[false,false,false]}',
      '{"pass":false,"reason":"Different animal."}',
    ]);
    expect((await verifyAnswer(client, request('Final answer: A striped animal'))).answer.outcome).toBe(
      'fail',
    );
    expect(seen).toHaveLength(5);
    expect(seen[3]?.system).toContain('Compare final answers');
  });
  it('lets full adjudication pass despite a dissenting blind solve', async () => {
    const { client, seen } = transport(['Final answer: 4', 'Final answer: 4', 'Final answer: 5', pass]);
    expect((await verifyAnswer(client, request())).answer.outcome).toBe('pass');
    expect(seen.at(-1)?.user).toContain('true,true,false');
  });
  it('never revives an earlier verdict after a malformed terminal pass object', async () => {
    const { client } = transport([...solves(), `${pass}\n{"pass":`]);
    expect((await verifyAnswer(client, request())).answer.outcome).toBe('inconclusive');
  });
  it('solves blind three times, then evaluates the complete criterion; records every call and cost', async () => {
    const { client, seen } = transport([...solves(), pass]);
    const result = await verifyAnswer(client, request());
    expect(result.answer.outcome).toBe('pass');
    expect(seen).toHaveLength(4);
    for (const call of seen.slice(0, 3)) {
      expect(call.user).toContain('What is 2 + 2?');
      expect(call.user).not.toContain('Final answer: 4');
    }
    expect(result.costUsd).toBeCloseTo(0.04);
    expect(result.requestCount).toBe(4);
    expect(JSON.parse(result.raw).calls).toHaveLength(4);
  });
  it('rejects a wrong answer while preserving exact numerical precision', async () => {
    const { client, seen } = transport([
      ...solves('9007199254740993'),
      '{"pass":false,"reason":"Different integer."}',
    ]);
    const result = await verifyAnswer(client, request('Final answer: 9007199254740992'));
    expect(result.answer.outcome).toBe('fail');
    expect(seen.at(-1)?.user).toContain('false,false,false');
  });
  it('does not turn a fabricated extraction into the corrected answer', async () => {
    const { client, seen } = transport([
      '4',
      ...solves(),
      '{"same":[false,false,false]}',
      '{"pass":false,"reason":"It says five."}',
    ]);
    const result = await verifyAnswer(client, request('I conclude five.'));
    expect(result.answer.outcome).toBe('fail');
    expect(seen.at(-1)?.user).toContain('I conclude five.');
    expect(JSON.parse(result.raw).extraction).toBe('tail');
  });
  it('reads final JSON despite unbalanced braces in the reasoning', async () => {
    const { client } = transport([...solves(), `Consider the set {4 and its elements.\n${pass}`]);
    expect((await verifyAnswer(client, request())).answer.outcome).toBe('pass');
  });
  it('requires a definite single commitment on otherwise passing unmarked answers', async () => {
    const { client } = transport(['4', ...solves(), pass, '{"finals":["4"],"committed":false}']);
    expect((await verifyAnswer(client, request('Probably 4, but I cannot confirm.'))).answer.outcome).toBe(
      'fail',
    );
  });
  it('does not pass malformed commitment or contradictory final answers', async () => {
    for (const commitment of ['not json', '{"finals":["4","5"],"committed":true}']) {
      const { client } = transport(['4', ...solves(), pass, commitment]);
      const result = await verifyAnswer(client, request('Result: 4'));
      expect(result.answer.outcome).toBe(commitment === 'not json' ? 'inconclusive' : 'fail');
    }
  });
  it.each([{ reference: '4' }, { inputs: [{ path: 'source.txt', text: '4' }] }, { artifact: '4' }])(
    'explicitly declines unsupported evidence scope %j',
    async (extra) => {
      const { client, seen } = transport([]);
      const result = await verifyAnswer(client, { ...request(), ...extra });
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.answer.reasoning).toMatch(/unsupported.*(reference|inputs|artifact)/);
      expect(seen).toHaveLength(0);
    },
  );
  it('does not silently ignore the rubric, pass definition, or fail definition', async () => {
    const { client, seen } = transport([
      ...solves(),
      '{"pass":false,"reason":"Missing required explanation."}',
    ]);
    const input = {
      ...request(),
      criterion: {
        name: 'correct',
        rubric: 'Give a correct answer and show working.',
        pass: 'Explains the sum.',
        fail: 'Answer only.',
      },
    };
    expect((await verifyAnswer(client, input)).answer.outcome).toBe('fail');
    expect(seen.at(-1)?.system).toContain('Give a correct answer and show working.');
    expect(seen.at(-1)?.system).toContain('Answer only.');
  });
  it('preserves units and delegates different representations to semantic matching', async () => {
    const { client, seen } = transport([
      ...solves('4 kg'),
      '{"same":[false,false,false]}',
      '{"pass":false,"reason":"Wrong unit."}',
    ]);
    expect((await verifyAnswer(client, request('Final answer: 4 m'))).answer.outcome).toBe('fail');
    expect(seen[3]?.user).toContain('4 m');
    expect(seen[3]?.user).toContain('4 kg');
  });
  it('does not assume numerically equal forms meet a requested form', async () => {
    const { client, seen } = transport([
      ...solves('4.0'),
      '{"same":[false,false,false]}',
      '{"pass":false,"reason":"Needs one decimal place."}',
    ]);
    expect(
      (await verifyAnswer(client, request('Final answer: 4', 'Give 2+2 to one decimal place.'))).answer
        .outcome,
    ).toBe('fail');
    expect(seen).toHaveLength(5);
  });
  it.each([
    { refusal: 'blocked' },
    { truncated: true },
    { providerBlock: { provider: 'anthropic' as const, reason: 'other' as const } },
    { text: 'no final marker' },
  ])('never passes invalid solver completion %j', async (invalid) => {
    const { client } = transport([{ text: 'Final answer: 4', ...invalid }]);
    expect((await verifyAnswer(client, request())).answer.outcome).toBe('inconclusive');
  });
  it('never passes invalid matcher or duplicate verdict keys', async () => {
    const badMatch = transport([...solves('four'), '{"same":[true,"true",true]}']);
    expect((await verifyAnswer(badMatch.client, request())).answer.outcome).toBe('inconclusive');
    const duplicate = transport([...solves(), '{"pass":false,"pass":true,"reason":"ambiguous"}']);
    expect((await verifyAnswer(duplicate.client, request())).answer.outcome).toBe('inconclusive');
  });
  it('accounts unknown cost and nested request counts without a partial total', async () => {
    const { client } = transport([
      { text: 'Final answer: 4', costUsd: undefined, requestCount: 2 },
      ...solves().slice(1),
      pass,
    ]);
    const result = await verifyAnswer(client, request());
    expect(result.costUsd).toBeUndefined();
    expect(result.costIncomplete).toBe(true);
    expect(result.requestCount).toBe(5);
  });
  it('audits thrown errors, preserving prior call costs as unknown total', async () => {
    const { client } = transport(['Final answer: 4', new Error('offline')]);
    const result = await verifyAnswer(client, request());
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.costIncomplete).toBe(true);
    expect(result.costUsd).toBeUndefined();
    expect(JSON.parse(result.raw).calls[1].error).toContain('offline');
  });
  it('preserves accounting and raw receipts from failed retrying transports', async () => {
    const failure = Object.assign(new Error('provider failure'), {
      raw: 'sanitized provider failure',
      requestCount: 3,
      costUsd: 0.03,
      retryReceipts: [{ raw: 'retry failed', exitCode: 1, category: 'overload', costUsd: 0.01 }],
    });
    const { client } = transport(['Final answer: 4', failure]);
    const result = await verifyAnswer(client, request());
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.costUsd).toBeCloseTo(0.04);
    expect(result.requestCount).toBe(4);
    expect(result.retryReceipts).toHaveLength(1);
    expect(JSON.parse(result.raw).calls[1].failure.raw).toBe('sanitized provider failure');
  });
  it('carries user context into every blind solve without leaking the submitted answer', async () => {
    const { client, seen } = transport([...solves(), pass]);
    const input = request();
    await verifyAnswer(client, {
      ...input,
      reasoning: 'high',
      transcript: [{ role: 'context', text: 'Use decimal arithmetic.' }, ...input.transcript],
    });
    for (const call of seen.slice(0, 3)) {
      expect(call.user).toContain('Use decimal arithmetic.');
      expect(call.reasoning).toBe('high');
      expect(call.user).not.toContain('Final answer: 4');
    }
  });
});
