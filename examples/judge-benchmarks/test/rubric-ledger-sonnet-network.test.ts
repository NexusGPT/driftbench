import { expect, it } from 'vitest';
import type { LedgerCompletion } from '../src/rubric-ledger-calls';
import { nativeNoAnswerError } from '../src/rubric-ledger-sonnet-network-completion';

const receipt = (result: string, output = 0, error = true): LedgerCompletion => ({
  text: result, raw: JSON.stringify({ type: 'result', is_error: error,
    result, usage: { input_tokens: 0, output_tokens: output }, total_cost_usd: 0 }),
  costUsd: 0, usage: { input: 0, output }, fingerprint: 'unchanged',
});

it('retains a zero-output transport receipt and clears only the banner, allowing missing-only retry', () => {
  const completion = receipt('API Error: Connection failed');
  const error = nativeNoAnswerError(completion) as Error & { completion: LedgerCompletion; retryable: boolean };
  expect(error.retryable).toBe(true);
  expect(error.completion.text).toBe('');
  expect(error.completion.raw).toBe(completion.raw);
  expect(error.completion.costUsd).toBe(0);
  expect(completion.text).toBe('API Error: Connection failed');
});

it('never retries provider blocks, generated refusals or unparsed generated answers', () => {
  for (const completion of [
    receipt('API Error: cannot help. https://www.anthropic.com/legal/aup Details: `[bio]`'),
    receipt('API Error: connection failed', 1),
    receipt('I cannot help.', 10, false),
    receipt('not valid JSON', 50, false),
  ]) expect(nativeNoAnswerError(completion)).toBeUndefined();
});

it('preserves explicit provider rejection status for quota and billing handling', () => {
  for (const status of [402, 429, 503]) {
    const error = nativeNoAnswerError(receipt(`API Error: ${status} rejected`)) as Error & { status: number };
    expect(error.status).toBe(status);
  }
  expect(nativeNoAnswerError(receipt('API Error: 400 invalid schema'))).toBeUndefined();
});

it('waits through a native session limit without converting it to a judge answer', () => {
  const zero = receipt("You've hit your limit. Try again later.");
  expect(nativeNoAnswerError(zero)).toMatchObject({ status: 429, retryable: true });
  expect(nativeNoAnswerError(receipt("You've hit your limit. Try again later.", 10))).toBeUndefined();
});
