import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore, withTransportRetry } from './exec.mjs';

const wait = async () => {};

test('a transport failure is retried, then the answer returns', async () => {
  const seen = [];
  const result = await withTransportRetry({ wait, attempt: async (n) => { seen.push(n); if (n < 3) throw new Error('timeout'); return 'answer'; } });
  assert.equal(result, 'answer');
  assert.deepEqual(seen, [1, 2, 3]);
});

test('a returned answer is never retried, even a refusal', async () => {
  let calls = 0;
  const result = await withTransportRetry({ wait, attempt: async () => { calls++; return { refusal: 'no', text: '' }; } });
  assert.equal(calls, 1);
  assert.equal(result.refusal, 'no');
});

test('three transport failures end as TRANSPORT_EXHAUSTED, with every try recorded', async () => {
  const failed = [];
  await assert.rejects(
    withTransportRetry({ wait, attempt: async () => { throw new Error('claude returned an error result'); }, failed: (n) => failed.push(n) }),
    (e) => e.transportExhausted === true && /TRANSPORT_EXHAUSTED after 3 tries/.test(e.message),
  );
  assert.deepEqual(failed, [1, 2, 3]);
});

test('a cap error before a try stops retrying at once', async () => {
  let calls = 0;
  await assert.rejects(
    withTransportRetry({ wait, before: (n) => { if (n === 2) throw new Error('BUDGET_CAP'); }, attempt: async () => { calls++; throw new Error('timeout'); } }),
    /BUDGET_CAP/,
  );
  assert.equal(calls, 1);
});

test('the semaphore never admits more than its limit', async () => {
  const gate = new Semaphore(4);
  let active = 0, maximum = 0;
  await Promise.all(Array.from({ length: 20 }, async () => {
    const release = await gate.acquire();
    maximum = Math.max(maximum, ++active);
    await new Promise((r) => setTimeout(r, 2));
    active--; release();
  }));
  assert.equal(maximum, 4);
});

test('a resumed call continues after the tries already recorded as failed', async () => {
  const seen = [];
  await assert.rejects(withTransportRetry({ wait, first: 3, attempt: async (n) => { seen.push(n); throw new Error('402'); } }), /TRANSPORT_EXHAUSTED/);
  assert.deepEqual(seen, [3]);
  await assert.rejects(withTransportRetry({ wait, first: 4, attempt: async (n) => { seen.push(n); } }), /TRANSPORT_EXHAUSTED/);
  assert.deepEqual(seen, [3]);
});

import { classifyHttp, PACING } from './exec.mjs';
const lite = PACING['gemini-3.5-flash-lite'];
const http = (code) => new Error(`https://x/models/m:generateContent answered ${code}: quota`);

test('flash-lite: 429 waits 20, 60, 180 s, then gives up after 4 tries', async () => {
  const waits = [];
  await assert.rejects(withTransportRetry({ wait: async (ms) => waits.push(ms), classify: (e) => classifyHttp(e, lite), rateWaitsMs: lite.rateWaitsMs,
    attempt: async () => { throw http(429); } }), /TRANSPORT_EXHAUSTED after 4 tries/);
  assert.deepEqual(waits, [20000, 60000, 180000]);
});

test('flash-lite: a 402 stops at once with no retry', async () => {
  let calls = 0;
  await assert.rejects(withTransportRetry({ wait, classify: (e) => classifyHttp(e, lite), rateWaitsMs: lite.rateWaitsMs,
    attempt: async () => { calls++; throw http(402); } }), (e) => e.providerStop === true && /PROVIDER_PAYMENT_STOP/.test(e.message));
  assert.equal(calls, 1);
});

test('flash-lite: other transport errors keep 3 tries; a 429 then an answer returns the answer', async () => {
  let n = 0;
  await assert.rejects(withTransportRetry({ wait, classify: (e) => classifyHttp(e, lite), rateWaitsMs: lite.rateWaitsMs,
    attempt: async () => { n++; throw new Error('could not be reached'); } }), /after 3 tries/);
  assert.equal(n, 3);
  const seq = [http(429)];
  const got = await withTransportRetry({ wait, classify: (e) => classifyHttp(e, lite), rateWaitsMs: lite.rateWaitsMs,
    attempt: async () => { if (seq.length) throw seq.shift(); return 'answer'; } });
  assert.equal(got, 'answer');
});

test('models without pacing keep the original 3-try rule, and 402 is a plain retry there', async () => {
  let n = 0;
  await assert.rejects(withTransportRetry({ wait, classify: (e) => classifyHttp(e, undefined), attempt: async () => { n++; throw http(402); } }), /after 3 tries/);
  assert.equal(n, 3);
});

import { isRecoverable, isZeroCost, isConnectionFailure, LinkMonitor } from './exec.mjs';
const unreachable = 'https://api.openai.com/v1/chat/completions could not be reached (TypeError)';
const timeout = 'https://api.openai.com/v1/chat/completions could not be reached (TimeoutError)';
const five = 'https://api.openai.com/v1/chat/completions answered 500: The server had an error';

test('no-answer classes: unreachable and 5xx recover at zero cost; a timeout recovers but keeps its reserve', () => {
  assert.deepEqual([unreachable, timeout, five].map(isRecoverable), [true, true, true]);
  assert.deepEqual([unreachable, timeout, five].map(isZeroCost), [true, false, true]);
  assert.deepEqual([unreachable, timeout, five].map(isConnectionFailure), [true, true, false]);
});

test('a provider error result or a quota error is not auto-recovered', () => {
  for (const text of ['claude returned an error result', 'x answered 429: quota', 'x answered 402: credits', 'INVALID_COST']) {
    assert.equal(isRecoverable(text), false);
    assert.equal(isZeroCost(text), false);
  }
});

test('the link monitor pauses on 3 consecutive connection failures and resets on an answer or a 500', () => {
  const m = new LinkMonitor(3);
  m.failed(unreachable); m.failed(timeout); m.answered(); m.failed(unreachable); m.failed(unreachable);
  assert.equal(m.paused, false);
  m.failed(five); m.failed(unreachable); m.failed(unreachable);
  assert.equal(m.paused, false);
  m.failed(timeout);
  assert.equal(m.paused, true);
});

import { readClaudeEnvelope } from './exec.mjs';
const env = (o) => JSON.stringify({ type: 'result', ...o });

test('claude envelope: zero output tokens on an error is a recoverable no-answer at its reported cost', () => {
  const r = readClaudeEnvelope(env({ is_error: true, terminal_reason: 'api_error', total_cost_usd: 0.0012, usage: { output_tokens: 0 }, result: 'claude returned an error result' }), 1);
  assert.deepEqual(r, { kind: 'no-answer', cost: 0.0012, reason: 'api_error' });
  assert.equal(isRecoverable(`claude envelope no-answer (terminal_reason=${r.reason})`), true);
});

test('claude envelope: any output tokens on an error is a final model-side failure, never re-sent', () => {
  const r = readClaudeEnvelope(env({ is_error: true, subtype: 'error_max_budget_usd', total_cost_usd: 0.1, usage: { output_tokens: 412 } }), 1);
  assert.equal(r.kind, 'model-failure');
});

test('claude envelope: a success is an answer; a crash without JSON is a no-envelope', () => {
  const ok = readClaudeEnvelope(env({ is_error: false, subtype: 'success', total_cost_usd: 0.02, result: '{"a":1}', usage: { output_tokens: 9 } }), 0);
  assert.deepEqual([ok.kind, ok.text, ok.truncated, ok.cost], ['answer', '{"a":1}', false, 0.02]);
  assert.equal(readClaudeEnvelope('Killed', 137).kind, 'no-envelope');
  assert.equal(isRecoverable('claude exited 137 without a JSON result'), true);
});
