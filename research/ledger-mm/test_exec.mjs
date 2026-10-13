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
