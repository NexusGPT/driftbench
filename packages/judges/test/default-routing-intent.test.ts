import { describe, expect, it } from 'vitest';
import type { DialectCompletionRequest, DialectTransport } from '../src/clients/transport';
import { createDefaultJudge } from '../src/default-judge';
import type { DefaultJudgeRequest } from '../src/normalize-record';
import fixtures from './fixtures/default-relevance-regressions.json';

/** Ordinary-reader false passes and obligation-ledger failures mirror the recorded live ablation. */
function reader(
  requestQuote = 'When is my visit and what is the arrival window?',
  answerQuote = 'I will check.',
) {
  const calls: DialectCompletionRequest[] = [];
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'intent-regression',
    async complete(request) {
      calls.push(request);
      const schema = JSON.stringify(request.schema);
      const response =
        schema.includes('request-fulfillment') || schema.includes('"route"')
        ? { intent: 'request-fulfillment', route: 'criterion' }
        : schema.includes('"obligation"')
          ? {
              checks: [
                {
                  obligation: 'Supply the requested values.',
                  requestQuote,
                  reasoning: 'Acknowledging the question supplies no requested values.',
                  answerQuote: null,
                  met: false,
                },
              ],
            }
          : {
              checks: [
                {
                  id: 'relevancy',
                  reasoning: 'The acknowledgement remains on the requested topic.',
                  evidence: [{ source: 'transcript.1', quote: answerQuote }],
                  met: true,
                },
              ],
            };
      const text = JSON.stringify(response);
      return { text, raw: text, dialect: 'scratchpad-json', fingerprint: 'intent-regression', costUsd: 0 };
    },
  };
  return { calls, judge: createDefaultJudge({ provider: 'anthropic', model: 'test', transport, env: {} }) };
}

describe('routing follows the declared metric intent', () => {
  it.each(fixtures)('uses the obligation ledger for $id', async ({ request }) => {
    const { judge, calls } = reader(request.transcript[0]?.text, request.transcript[1]?.text);
    const result = await judge.judge(request as DefaultJudgeRequest);
    expect(result.answer.outcome).toBe('fail');
    expect(result.defaultJudge?.route).toBe('relevance');
    expect(calls).toHaveLength(3);
    expect(result.responseRelevance?.checks.some((check) => check.met === false)).toBe(true);
  });

  it('makes one intent choice for the criterion and shape, independent of question and answer text', async () => {
    const { judge, calls } = reader();
    for (const fixture of fixtures) await judge.judge(fixture.request as DefaultJudgeRequest);
    const routing = calls.filter(
      (call) =>
        JSON.stringify(call.schema).includes('"route"') ||
        JSON.stringify(call.schema).includes('request-fulfillment'),
    );
    expect(routing).toHaveLength(1);
    const input = JSON.parse(routing[0]?.user ?? '{}');
    expect(input.criterion).toEqual(fixtures[0]?.request.criterion);
    expect(input).not.toHaveProperty('questions');
    expect(input).not.toHaveProperty('transcript');
    expect(input).not.toHaveProperty('candidates');
  });
});
