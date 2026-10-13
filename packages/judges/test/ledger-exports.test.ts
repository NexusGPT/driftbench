import { expect, test } from 'vitest';
import * as judges from '../src/index';

test('benchmark consumers can import the ledger and schema-independent transport from the package', () => {
  expect(judges.SHIM_SCHEMA_FLAG).toBe('--json-schema');
  expect(judges.FROZEN_BENCHMARK_REASONING['gpt-6-luna']).toBe('medium');
  for (const value of [
    judges.ClaudeTransportError,
    judges.pairLedgerRequest,
    judges.pairLedgerSchema,
    judges.parsePairLedgerText,
    judges.verdictFromLedger,
    judges.createDialectTransport,
    judges.buildDialectRequest,
  ])
    expect(value).toBeTypeOf('function');
});
