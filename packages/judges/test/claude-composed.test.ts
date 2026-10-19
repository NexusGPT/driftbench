import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { tempFolderSync } from '../../../tools/test-setup/temp-folders';
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

const lines = (log: string) => readFileSync(log, 'utf8').split('\n').filter(Boolean);

/** A fake command that answers the nth process with the nth envelope and logs the effort it was given. */
function scripted(sequence: readonly unknown[]) {
  const log = join(tempFolderSync('driftbench-composed-'), 'efforts');
  const script = `const f=require('node:fs');const log=process.env.COMPOSED_LOG;const n=f.existsSync(log)?f.readFileSync(log,'utf8').split('\\n').filter(Boolean).length:0;const at=process.argv.indexOf('--effort');const cap=process.argv.indexOf('--max-budget-usd');f.appendFileSync(log,(at<0?'native':process.argv[at+1])+' '+(cap<0?'none':process.argv[cap+1])+'\\n');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const all=${JSON.stringify(sequence)};const p=all[Math.min(n,all.length-1)];process.stdout.write(JSON.stringify(p));if(p.is_error)process.exitCode=1;});`;
  return {
    options: {
      model: 'fictional',
      env: { COMPOSED_LOG: log },
      command: process.execPath,
      commandArgs: ['--eval', script, '--'],
      sleep: async () => {},
    },
    efforts: () => lines(log).map((line) => line.split(' ')[0]),
    /** The --max-budget-usd each process was given. */
    budgets: () => lines(log).map((line) => Number(line.split(' ')[1])),
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

const costly = { ...overload, total_cost_usd: 0.9 };
const late = { ...answer, total_cost_usd: 0.2 };
it('gives a transient retry only what is left of the cap', async () => {
  const fake = scripted([costly, late]);
  const r = await createDialectTransport({
    ...fake.options,
    provider: 'claude-cli',
    maxBudgetUsd: 1,
  }).complete(prompt);
  expect(r.requestCount).toBe(2);
  const [first, second] = fake.budgets();
  expect(first).toBe(1);
  expect(second).toBeCloseTo(0.1);
});
it('starts no retry once earlier processes have spent the cap', async () => {
  const fake = scripted([costly, costly, late]);
  await expect(
    createDialectTransport({ ...fake.options, provider: 'claude-cli', maxBudgetUsd: 1 }).complete(prompt),
  ).rejects.toMatchObject({
    category: 'overload',
    retryable: true,
    retrySkipped: 'spend-cap',
    requestCount: 2,
    costUsd: 1.8,
  });
  expect(fake.budgets()).toHaveLength(2);
  expect(fake.budgets()[1]).toBeCloseTo(0.1);
});
it('starts no retry when the remainder cannot cover the reservation', async () => {
  const fake = scripted([costly, late]);
  await expect(
    createClaudeCliJudge({ ...fake.options, maxBudgetUsd: 1, retryMaxCostUsd: 0.2 }).judge({
      criterion: { name: 'greeting', rubric: 'Use a greeting.' },
      transcript: [{ role: 'agent', text: 'Hello.' }],
    }),
  ).rejects.toMatchObject({ category: 'overload', retrySkipped: 'spend-cap', requestCount: 1 });
  expect(fake.budgets()).toEqual([1]);
});
it('starts no retry under a cap when an earlier process reported no cost', async () => {
  const { total_cost_usd: _, ...unpriced } = overload;
  const fake = scripted([unpriced, answer]);
  await expect(
    createDialectTransport({ ...fake.options, provider: 'claude-cli', maxBudgetUsd: 1 }).complete(prompt),
  ).rejects.toMatchObject({ retrySkipped: 'spend-cap', requestCount: 1, costIncomplete: true });
  expect(fake.budgets()).toEqual([1]);
});
it('keeps retries unchanged without a cap', async () => {
  const fake = scripted([costly, costly, late]);
  const r = await createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt);
  expect(r.requestCount).toBe(3);
  expect(r.costUsd).toBeCloseTo(2);
  expect(fake.budgets()).toEqual([Number.NaN, Number.NaN, Number.NaN]);
});
it('reports an unknown total as unknown, never the last process alone', async () => {
  const { total_cost_usd: _, ...unpriced } = exhausted;
  const fake = scripted([unpriced, answer]);
  const r = await createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt);
  expect(r.thinkingRecovery?.requestCount).toBe(2);
  expect(r.costUsd).toBeUndefined();
  expect(r.costIncomplete).toBe(true);
  const judged = await createClaudeCliJudge(scripted([unpriced, answer]).options).judge({
    criterion: { name: 'greeting', rubric: 'Use a greeting.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(judged.costUsd).toBeUndefined();
  expect(judged.costIncomplete).toBe(true);
});
it('leaves a fully priced call unflagged', async () => {
  const fake = scripted([exhausted, answer]);
  const r = await createDialectTransport({ ...fake.options, provider: 'claude-cli' }).complete(prompt);
  expect(r.costUsd).toBeCloseTo(0.04);
  expect(r.costIncomplete).toBeUndefined();
});
