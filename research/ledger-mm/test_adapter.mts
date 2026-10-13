import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgePairLedger, pairLedgerRequest } from '../../packages/judges/src/pair-ledger.ts';
import { buildPrompt } from '../../packages/judges/src/prompt.ts';
import { parsePairLedgerText } from '../../packages/judges/src/pair-ledger-contract.ts';

test('package adapter reads both orders and passes no benchmark label', async () => {
  const requests: any[] = [];
  const input = pairLedgerRequest({ name: 'test', rubric: 'Prefer the factual answer.' },
    [{ role: 'user', text: 'What is 2 + 2?' }], 'Correct reply: 4', 'Wrong reply: 5',
    { requirements: [{ name: 'correct_claims', rubric: 'Correct facts.', hard: true }] });
  const client: any = { id: 'fake', family: 'fake', cls: 'system2', cost: 0, dialect: 'scratchpad-json',
    async judge(request: any) {
      requests.push(request);
      const prompt = buildPrompt(request);
      assert.ok(prompt.user.includes('first_data'));
      assert.ok(!prompt.user.includes('handLabel'));
      const firstWins = request.candidates.A.startsWith('Correct');
      const raw = JSON.stringify({ items: [{ name: 'correct_claims', first: firstWins ? 4 : 0,
        second: firstWins ? 0 : 4, reasoning: 'Check 2+2.', evidence: null }] });
      return parsePairLedgerText(raw, request);
    } };
  const result = await judgePairLedger(client, input, { stage0: { compute: false, correctness: false } });
  assert.equal(result.choice, 'first');
  assert.equal(result.calls, 2);
  assert.equal(requests[1].candidates.A, input.candidates!.B);
});

test('harm facts and blind compute ports can decide without ledger calls', async () => {
  const input = pairLedgerRequest({ name: 'test', rubric: 'Safe and correct.' }, [{ role: 'user', text: 'Question only' }], 'Answer: 4', 'Answer: 5',
    { requirements: [{ name: 'correct_claims', rubric: 'Correct facts.', hard: true }] });
  const client: any = { id: 'fake', family: 'fake', cls: 'system2', cost: 0, async judge() { throw new Error('ledger should not run'); } };
  let blind = '';
  const computed = await judgePairLedger(client, input, { stage0: { correctness: true, compute: {
    async solve(question) { blind = question; return { answer: '4' }; },
    async backwardCheck({ answer }) { return /4\s*$/.test(answer); },
  } } });
  assert.equal(blind, 'Question only');
  assert.equal(computed.choice, 'first');
  const harm = await judgePairLedger(client, input, { stage0: { harmPolicy: {
    requestHarmful: true, first: { refuses: false, enablesHarm: true }, second: { refuses: true, enablesHarm: false },
  } } });
  assert.equal(harm.choice, 'second');
  assert.equal(harm.calls, 0);
});
