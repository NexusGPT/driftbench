import { expect, test } from 'vitest';
import { LedgerCalls, LedgerRateLimitStop, LedgerPrepaymentStop } from '../src/rubric-ledger-calls';
import { checkQuotaWindow } from '../src/rubric-ledger-quota';
import { evaluate, validityFixtures } from '../src/rubric-ledger-live';
import { type DialectTransport } from '@agent-nexus/driftbench-judges';
import { scratch } from './scratch';

test('Gemini cannot reserve before reset or at cutoff; reset alone never grants permission', async () => {
  const before = Date.parse('2026-10-13T23:59:59Z'), reset = Date.parse('2026-10-14T00:00:00Z');
  const cutoff = Date.parse('2026-10-14T12:00:00Z');
  expect(() => checkQuotaWindow('gemini-3.8-flash', before)).toThrow(LedgerRateLimitStop);
  expect(() => checkQuotaWindow('gemini-3.8-flash', before, true)).not.toThrow();
  expect(() => checkQuotaWindow('gemini-3.8-flash', reset)).toThrow(LedgerRateLimitStop);
  expect(() => checkQuotaWindow('gemini-3.8-flash', reset, true)).not.toThrow();
  expect(() => checkQuotaWindow('gemini-3.8-flash', cutoff, true)).toThrow(LedgerRateLimitStop);
  expect(() => checkQuotaWindow('claude-haiku-5-5', before)).not.toThrow();
  let clock = reset, submitted = 0;
  const calls = await new LedgerCalls(await scratch('quota-window-'), 1, Infinity,
    (i) => checkQuotaWindow(i.model, clock, true)).load();
  const identity = { model: 'gemini-3.8-flash', phase: 'test', item: 'fixture', contestant: 'promptfoo',
    sample: 0, ordinal: 0, request: {}, transportFingerprint: 'fixture' };
  const complete = async () => { submitted++; return { text: '0', raw: '{}', fingerprint: 'fixture', costUsd: .001 }; };
  await calls.complete(identity, .1, complete, () => undefined);
  clock = cutoff;
  await calls.complete(identity, .1, complete, () => undefined); // Saved answer remains readable.
  await expect(calls.complete({ ...identity, ordinal: 1 }, .1, complete, () => undefined)).rejects.toBeInstanceOf(LedgerRateLimitStop);
  expect(submitted).toBe(1); expect(calls.uncertainKeys).toHaveLength(0);
});

test('reset renews only quota failures, preserves partial answers and never renews a returned block', async () => {
  const root = await scratch('quota-resume-');
  let calls = await new LedgerCalls(root, 2).load(), count = 0, reset = false;
  const fake: DialectTransport = { dialect: 'scratchpad-json', fingerprint: 'quota-resume-fixture',
    async complete() {
      count++;
      if (count === 1) return { text: '0', raw: '{}', fingerprint: 'quota-resume-fixture', dialect: 'scratchpad-json', costUsd: .001 };
      if (!reset) throw Object.assign(new Error('quota'), { status: 429, retryable: true });
      return { text: '', raw: '{}', fingerprint: 'quota-resume-fixture', dialect: 'scratchpad-json', refusal: 'BLOCKED', costUsd: .001 };
    } };
  const item = validityFixtures()[0]!;
  const run = (epoch?: number) => evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], 'gemini-3.8-flash',
    'quota-resume-fixture', 0, 'promptfoo', fake, calls, true, async () => undefined, undefined, epoch);
  await expect(run()).rejects.toBeInstanceOf(LedgerRateLimitStop);
  expect(count).toBe(5);
  calls = await new LedgerCalls(root, 2).load(); reset = true;
  const result = await run(1); expect(count).toBe(6); expect(result.callKeys).toHaveLength(2);
  await run(1); await run(2); expect(count).toBe(6);
  expect(calls.rows.filter((r) => r.status === 'ok')).toHaveLength(2);
  expect(calls.rows.filter((r) => r.httpStatus === 429)).toHaveLength(4);
});

test('the same quota epoch cannot renew exhaustion again, nor bypass a 402', async () => {
  for (const status of [429, 402]) {
    const root = await scratch('quota-rejection-'); let calls = await new LedgerCalls(root, 1).load(), count = 0;
    const fake: DialectTransport = { dialect: 'scratchpad-json', fingerprint: 'quota-exhaustion-fixture',
      async complete() { count++; throw Object.assign(new Error(`HTTP ${status}`), { status, retryable: true }); } };
    const item = validityFixtures()[0]!;
    const run = (epoch: number) => evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], 'gemini-3.8-flash',
      'quota-exhaustion-fixture', 0, 'promptfoo', fake, calls, true, async () => undefined, undefined, epoch);
    const stop = status === 429 ? LedgerRateLimitStop : LedgerPrepaymentStop;
    await expect(run(1)).rejects.toBeInstanceOf(stop);
    const firstCount = count; calls = await new LedgerCalls(root, 1).load();
    await expect(run(1)).rejects.toBeInstanceOf(stop); expect(count).toBe(firstCount);
    if (status === 402) { await expect(run(2)).rejects.toBeInstanceOf(stop); expect(count).toBe(1); }
    expect(calls.chargedUsd).toBe(0);
  }
});
