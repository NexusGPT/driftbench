import { expect, it } from 'vitest';
import type { LedgerCall } from '../src/rubric-ledger-calls';
import type { DecisionRow } from '../src/rubric-ledger-live';
import { classifyAllProviderBlocks, nativeProviderBlockReason } from '../src/rubric-ledger-native-blocks';

it('scores a native provider block against either contestant, preserving the received decision', () => {
  const call = { key: 'blocked', status: 'ok', text: 'API Error', completion: { raw: JSON.stringify({
    is_error: true, usage: { output_tokens: 0 },
    result: "API Error: cannot help. https://www.anthropic.com/legal/aup Details: `[bio]`" }) } } as LedgerCall;
  expect(nativeProviderBlockReason(call)).toBe('[bio]');
  for (const contestant of ['pair-ledger', 'promptfoo']) {
    const row = { contestant, callKeys: ['blocked'], decisions: ['A', 'A'] } as DecisionRow;
    const result = classifyAllProviderBlocks(row, [call]);
    expect(result.decisions).toEqual(['tie', 'tie']);
    expect(result.returnedDecisions).toEqual(['A', 'A']);
    expect(result.blockedCallKeys).toEqual(['blocked']);
  }
  call.completion!.raw = JSON.stringify({ is_error: false, usage: { output_tokens: 10 }, result: 'I cannot help.' });
  expect(nativeProviderBlockReason(call)).toBeUndefined();
  call.completion!.raw = JSON.stringify({ is_error: true, usage: { output_tokens: 0 }, result: 'API Error: connection failed' });
  expect(nativeProviderBlockReason(call)).toBeUndefined();
});
