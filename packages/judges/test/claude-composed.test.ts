import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createClaudeCliJudge } from '../src/clients/claude-cli';
import { CLAUDE_SUBMISSION_CEILING } from '../src/clients/claude-errors';
import { createDialectTransport } from '../src/clients/transport';

const exhausted = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error: 'max_output_tokens',
  result: "API Error: Claude's response exceeded the 16384 output token maximum.",
  total_cost_usd: 0.03,
  usage: { input_tokens: 20, output_tokens: 65536 },
};
const overload = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  result: 'API Error: 529 overloaded_error',
  total_cost_usd: 0.02,
  usage: { input_tokens: 20, output_tokens: 0 },
};
const answer = {
  type: 'result',
  subtype: 'success',
  result: '{"checks":[{"id":"greeting","met":true,"reasoning":"A greeting.","evidence":"Hello."}]}',
  total_cost_usd: 0.01,
  usage: { input_tokens: 20, output_tokens: 40 },
};
const prompt = { system: 'Assess a fictional reply.', user: 'Hello.' };

/** A fake command that answers the nth process with the nth envelope and logs the effort it was given. */
function scripted(sequence: readonly unknown[]) {
  const log = join(mkdtempSync(join(tmpdir(), 'driftbench-composed-')), 'efforts');
  const script = `const f=require('node:fs');const log=process.env.COMPOSED_LOG;const n=f.existsSync(log)?f.readFileSync(log,'utf8').split('\\n').filter(Boolean).length:0;const at=process.argv.indexOf('--effort');f.appendFileSync(log,(at<0?'native':process.argv[at+1])+'\\n');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const all=${JSON.stringify(sequence)};const p=all[Math.min(n,all.length-1)];process.stdout.write(JSON.stringify(p));if(p.is_error)process.exitCode=1;});`;
  return {
    options: {
      model: 'fictional',
      env: { COMPOSED_LOG: log },
      command: process.execPath,
      commandArgs: ['--eval', script, '--'],
      sleep: async () => {},
    },
    efforts: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

it('recovers thinking at low effort, then retries a transient failure, within the ceiling', async () => {
  const fake = scripted([exhausted, overload, answer]);
  const r = await createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt);
  expect(JSON.parse(r.text).checks).toHaveLength(1);
  expect(fake.efforts()).toEqual(['native', 'low', 'low']);
  expect(r.requestCount).toBe(3);
  expect(r.requestCount).toBeLessThanOrEqual(CLAUDE_SUBMISSION_CEILING);
  expect(r.thinkingRecovery).toMatchObject({ reason: 'reasoning-budget-exhausted', requestCount: 2 });
  expect(r.thinkingRecovery?.attempts.map((a) => a.costUsd)).toEqual([0.03, 0.01]);
  expect(r.retryReceipts).toMatchObject([{ category: 'overload', costUsd: 0.02, exitCode: 1 }]);
  expect(r.costUsd).toBeCloseTo(0.06);
  expect(r.usage).toEqual({ input: 60, output: 65576 });
});
it('composes the same way in the contract-aware judge, retry first', async () => {
  const fake = scripted([overload, exhausted, answer]);
  const r = await createClaudeCliJudge(fake.options).judge({
    criterion: { name: 'greeting', rubric: 'Use a greeting.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(r.answer.outcome).toBe('pass');
  expect(fake.efforts()).toEqual(['native', 'native', 'low']);
  expect(r.requestCount).toBe(3);
  expect(r.thinkingRecovery?.requestCount).toBe(2);
  expect(r.retryReceipts).toMatchObject([{ category: 'overload' }]);
  expect(r.costUsd).toBeCloseTo(0.06);
});
it('never starts a fourth process: no recovery once retries used the ceiling', async () => {
  const fake = scripted([overload, overload, exhausted, answer]);
  await expect(
    createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    requestCount: 3,
    costUsd: 0.07,
    thinkingRecovery: { requestCount: 1, retrySkipped: 'submission-ceiling' },
    retryReceipts: [{ category: 'overload' }, { category: 'overload' }],
  });
  expect(fake.efforts()).toHaveLength(3);
});
it('never starts a fourth process: no retry once the recovery used the ceiling', async () => {
  const fake = scripted([exhausted, overload, overload, answer]);
  await expect(
    createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt),
  ).rejects.toMatchObject({
    category: 'overload',
    retryable: true,
    requestCount: 3,
    costUsd: 0.07,
    thinkingRecovery: { requestCount: 1 },
    retryReceipts: [{ category: 'overload' }, { category: 'overload' }],
  });
  expect(fake.efforts()).toEqual(['native', 'low', 'low']);
});
it('counts a failed retry against the spend cap before a recovery process', async () => {
  const fake = scripted([overload, exhausted, answer]);
  await expect(
    createDialectTransport({
      ...fake.options,
      provider: 'claude-cli',
      maxBudgetUsd: 0.06,
      retryMaxCostUsd: 0.02,
    }).complete(prompt),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    costUsd: 0.05,
    requestCount: 2,
    thinkingRecovery: { requestCount: 1, retrySkipped: 'spend-cap' },
  });
  expect(fake.efforts()).toHaveLength(2);
});
