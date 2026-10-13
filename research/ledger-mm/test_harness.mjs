import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Budget, workers, costOf, redact } from './harness.mjs';

test('reservation gate survives restart and counts unknown calls', () => {
  const dir = mkdtempSync(new URL('./runtime-budget-', import.meta.url).pathname);
  try {
    let budget = new Budget(join(dir, 'spend.jsonl'), .2);
    budget.reserve('one', .1, {});
    budget.reserve('two', .1, {});
    assert.throws(() => budget.reserve('three', .1, {}), /BUDGET_CAP/);
    budget.settle('one', .01);
    budget = new Budget(join(dir, 'spend.jsonl'), .2);
    assert.equal(budget.used, .11);
    assert.throws(() => budget.reserve('two', .1, {}), /CALL_ALREADY_STARTED/);
    budget.reserve('three', .05, {});
    assert.throws(() => budget.settle('three', .06), /INVALID_COST/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('workers execute every task once with bounded concurrency', async () => {
  let active = 0, maximum = 0;
  const seen = [];
  await workers([1, 2, 3, 4, 5], 2, async (x) => {
    maximum = Math.max(maximum, ++active);
    await new Promise(r => setTimeout(r, 1));
    seen.push(x); active--;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
});
test('Gemini reasoning tokens and OpenAI cached input are billed', () => {
  assert.equal(costOf('gemini-3.8-flash', {raw: JSON.stringify({usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 90}})}), .00045);
  assert.equal(costOf('gpt-6-luna', {raw: JSON.stringify({usage: {prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: {cached_tokens: 50}}})}), .0000155);
});
test('known key forms are redacted', () => {
  assert.equal(redact('failed sk-example_123 then AIzaExample'), 'failed [redacted] then [redacted]');
});
