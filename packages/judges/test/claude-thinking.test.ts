import { expect, it } from 'vitest';
import { CLAUDE_SETTINGS, createClaudeCliJudge } from '../src/clients/claude-cli';
import { createDialectTransport } from '../src/clients/transport';

const failure = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error: 'max_output_tokens',
  result: "API Error: Claude's response exceeded the 16384 output token maximum.",
  total_cost_usd: 0.03,
  usage: { input_tokens: 20, output_tokens: 65536, output_tokens_details: { thinking_tokens: 65536 } },
};
const success = {
  type: 'result',
  subtype: 'success',
  result: '{"checks":[{"id":"greeting","met":true,"reasoning":"A greeting.","evidence":"Hello."}]}',
  total_cost_usd: 0.01,
  usage: { input_tokens: 20, output_tokens: 40 },
};
const script = `let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(process.argv.includes('low')?${JSON.stringify(success)}:${JSON.stringify(failure)})));`;
const options = {
  model: 'fictional',
  env: {},
  command: process.execPath,
  commandArgs: ['--eval', script, '--'],
};
const prompt = { system: 'Assess a fictional reply.', user: 'Hello.' };
it('recovers the recorded all-thinking CLI receipt once with lower effort and both costs', async () => {
  const r = await createDialectTransport({ ...options, provider: 'claude-cli' }).complete(prompt);
  expect(JSON.parse(r.text).checks).toHaveLength(1);
  expect(r.thinkingRecovery?.requestCount).toBe(2);
  expect(r.thinkingRecovery?.reason).toBe('reasoning-budget-exhausted');
  expect(r.usage).toEqual({ input: 40, output: 65576 });
  expect(r.costUsd).toBeCloseTo(0.04);
});
it('supports the contract-aware judge too', async () => {
  const r = await createClaudeCliJudge(options).judge({
    criterion: { name: 'greeting', rubric: 'Use a greeting.' },
    transcript: [{ role: 'agent', text: 'Hello.' }],
  });
  expect(r.answer.outcome).toBe('pass');
  expect(r.costUsd).toBeCloseTo(0.04);
  expect(r.thinkingRecovery?.requestCount).toBe(2);
});
it('does not send a second request without sufficient reserved spend', async () => {
  await expect(
    createDialectTransport({
      ...options,
      provider: 'claude-cli',
      maxBudgetUsd: 0.04,
      retryMaxCostUsd: 0.02,
    }).complete(prompt),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    costUsd: 0.03,
    thinkingRecovery: { requestCount: 1, retrySkipped: 'spend-cap' },
  });
});
it('keeps defaults byte identical and fingerprints an opt-in effort', async () => {
  expect(createClaudeCliJudge(options).settings).toBe(CLAUDE_SETTINGS);
  const base = createDialectTransport({ ...options, provider: 'claude-cli' });
  expect(
    createDialectTransport({ ...options, provider: 'claude-cli', claudeEffort: undefined }).fingerprint,
  ).toBe(base.fingerprint);
  const opted = createDialectTransport({ ...options, provider: 'claude-cli', claudeEffort: 'low' });
  expect(opted.fingerprint).not.toBe(base.fingerprint);
  const r = await opted.complete(prompt);
  expect(r.thinkingRecovery).toBeUndefined();
  expect(r.costUsd).toBe(0.01);
});
it('does not loop when low effort also exhausts thinking', async () => {
  const always = `process.stdout.write(JSON.stringify(${JSON.stringify(failure)}))`;
  await expect(
    createDialectTransport({
      ...options,
      provider: 'claude-cli',
      commandArgs: ['--eval', always, '--'],
    }).complete(prompt),
  ).rejects.toMatchObject({
    code: 'reasoning-budget-exhausted',
    costUsd: 0.06,
    thinkingRecovery: { requestCount: 2 },
  });
});
