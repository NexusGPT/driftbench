import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NetworkLedgerCalls, connectionFailure } from '../src/rubric-ledger-network-calls';
import type { CallIdentity, LedgerCall } from '../src/rubric-ledger-calls';
class OfflineCalls extends NetworkLedgerCalls { override async waitForNetwork() {} }
const identity: CallIdentity = { model: 'gpt-6.1-sol', phase: 'pilot', item: 'offline', contestant: 'pair-ledger',
  sample: 0, ordinal: 0, transportFingerprint: 'fixed', request: { system: 's', user: 'u' } };
describe('network runtime amendment', () => {
  it('retains a zero-token rejection receipt as unspent and never resends the eventual answer', async () => {
    const folder = mkdtempSync(join('.cache/ledger-rb/', 'network-test-'));
    const calls = await new OfflineCalls(folder, 1, identity.model, 'openai').load();
    let attempts = 0;
    const execute = async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('network connection reset'), { retryable: true,
        completion: { text: '', raw: '{"usage":{"output_tokens":0}}', fingerprint: 'f', costUsd: 0, usage: { input: 0, output: 0 } } });
      return { text: 'returned', raw: '{}', fingerprint: 'f', costUsd: .02 };
    };
    expect((await calls.complete(identity, .25, execute, () => undefined)).text).toBe('returned');
    expect((await calls.complete(identity, .25, execute, () => undefined)).text).toBe('returned');
    expect(attempts).toBe(2); expect(calls.rows[0]?.costUsd).toBe(0); expect(calls.rows[0]?.costBasis).toBe('no-answer');
    expect(calls.rows[0]?.completion?.raw).toContain('output_tokens'); expect(calls.chargedUsd).toBe(.02);
  });
  it('advances exhausted transport attempt identities without imposing another three-try ceiling', async () => {
    const folder = mkdtempSync(join('.cache/ledger-rb/', 'network-test-'));
    const calls = await new OfflineCalls(folder, 1, identity.model, 'openai').load();
    let n = 0;
    await calls.complete(identity, .1, async () => {
      if (++n <= 4) throw Object.assign(new Error('HTTP service temporarily unavailable'), { status: 503, retryable: true,
        completion: { text: '', raw: '{}', fingerprint: 'f', costUsd: 0, usage: { input: 0, output: 0 } } });
      return { text: '', raw: '{"incomplete_details":{"reason":"max_output_tokens"}}', fingerprint: 'f', costUsd: .02, truncated: true };
    }, () => undefined);
    expect(n).toBe(5); expect(calls.rows.map((r) => r.identity.transportAttempt ?? 0)).toEqual([0, 1, 2, 3, 4]);
    await calls.complete(identity, .1, async () => { throw new Error('must never run'); }, () => undefined);
    expect(calls.rows).toHaveLength(5);
  });
  it('counts connection failures separately from returned answers and HTTP service errors', () => {
    expect(connectionFailure({ status: 'error', error: 'Responses transport: socket timeout' } as LedgerCall)).toBe(true);
    expect(connectionFailure({ status: 'error', httpStatus: 503, error: 'service unavailable' } as LedgerCall)).toBe(false);
    expect(connectionFailure({ status: 'ok', text: '', completion: { truncated: true } } as LedgerCall)).toBe(false);
  });
});
