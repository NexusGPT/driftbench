import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LedgerBudgetStop, LedgerCalls, transportRetryable, type CallIdentity } from '../src/rubric-ledger-calls';
import { scratch } from './scratch';

const identity: CallIdentity = { model: 'fake', phase: 'pilot', item: 'p1', contestant: 'ledger',
  sample: 0, ordinal: 0, transportFingerprint: 'fixed', request: { system: 'check', user: 'data' } };
const reply = { text: 'answer', raw: '{}', fingerprint: 'test', costUsd: 0.02 };

describe('paid-call reservations and replay', () => {
  it('recognizes legacy recorded network failures without treating provider rejection as transport', () => {
    expect(transportRetryable({ error: 'https://api.openai.com/v1/chat/completions could not be reached (TypeError)' })).toBe(true);
    expect(transportRetryable({ error: 'HTTP 400 invalid schema' })).toBe(false);
    expect(transportRetryable({ error: 'fetch failed', retryable: false })).toBe(false);
  });
  it('coalesces duplicate work while giving independent reads new keys', async () => {
    const dir = await scratch('ledger-calls-');
    const store = await new LedgerCalls(dir, 1).load();
    let calls = 0;
    const execute = async () => { calls++; return reply; };
    const [a, b] = await Promise.all([
      store.complete(identity, 0.1, execute, () => undefined),
      store.complete(identity, 0.1, execute, () => undefined),
    ]);
    expect(a.key).toBe(b.key); expect(calls).toBe(1);
    const third = await store.complete({ ...identity, ordinal: 2 }, 0.1, execute, () => undefined);
    expect(third.key).not.toBe(a.key); expect(calls).toBe(2);
    const resumed = await new LedgerCalls(dir, 1).load();
    expect(resumed.chargedUsd).toBeCloseTo(0.04);
    await resumed.complete(identity, 0.1, execute, () => undefined, true);
    expect(calls).toBe(2);
  });
  it('reserves before starting calls so concurrency cannot oversubscribe', async () => {
    const store = await new LedgerCalls(await scratch('ledger-cap-'), 0.1).load();
    let finish!: (r: typeof reply) => void;
    const first = store.complete(identity, 0.1, () => new Promise((r) => { finish = r; }), () => undefined);
    while (!finish) await new Promise((r) => setTimeout(r, 1));
    await expect(store.complete({ ...identity, item: 'p2' }, 0.1, async () => reply, () => undefined))
      .rejects.toBeInstanceOf(LedgerBudgetStop);
    finish(reply); await first;
    expect(store.chargedUsd).toBeCloseTo(0.02);
  });
  it('records unanswered errors, charges their reserve, and never retries them as content', async () => {
    const dir = await scratch('ledger-failure-');
    const store = await new LedgerCalls(dir, 1).load();
    const result = await store.complete(identity, 0.1, async () => { throw new Error('offline'); }, () => undefined);
    expect(result.status).toBe('error'); expect(store.chargedUsd).toBe(0.1);
    const resumed = await new LedgerCalls(dir, 1).load();
    expect((await resumed.complete(identity, 0.1, async () => { throw new Error('must not call'); }, () => undefined)).error).toBe('offline');
    await appendFile(join(dir, 'starts.jsonl'), `${JSON.stringify({ key: 'uncertain', reserveUsd: 0.2, identity, startedAt: 'fixture' })}\n`);
    expect((await new LedgerCalls(dir, 1).load()).uncertainKeys).toEqual(['uncertain']);
    expect((await new LedgerCalls(dir, 1).load()).chargedUsd).toBeCloseTo(0.3);
    const interrupted = await new LedgerCalls(dir, 1).load();
    expect(await interrupted.recoverInterrupted()).toBe(1);
    expect(interrupted.uncertainKeys).toHaveLength(0);
    expect(interrupted.rows.find((r) => r.key === 'uncertain')?.retryable).toBe(true);
    expect(interrupted.chargedUsd).toBeCloseTo(.3);
  });
  it('rejects a missing replay before invoking a provider', async () => {
    const store = await new LedgerCalls(await scratch('ledger-free-'), 1).load();
    let invoked = false;
    await expect(store.complete(identity, 0.1, async () => { invoked = true; return reply; }, () => undefined, true))
      .rejects.toThrow('Replay missing');
    expect(invoked).toBe(false); expect(store.chargedUsd).toBe(0);
  });
});
