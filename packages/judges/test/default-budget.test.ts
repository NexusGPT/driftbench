import { describe, expect, it } from 'vitest';
import {
  buildDialectRequest,
  createDialectTransport,
  type DialectCompletionRequest,
  type DialectTransport,
} from '../src/clients/transport';
import { createDefaultJudge } from '../src/default-judge';
import { JudgeError } from '../src/http';

const request = { criterion: { name: 'x', rubric: 'Require an answer.' }, transcript: [] };
const prompt = { system: 'Judge data.', user: 'Fixture.' };
const answer = '{"checks":[{"id":"x","reasoning":"missing","evidence":null,"met":false}]}';
const completion = (text: string, costUsd?: number) => ({
  text,
  raw: text,
  dialect: 'scratchpad-json' as const,
  fingerprint: 'test',
  ...(costUsd === undefined ? {} : { costUsd }),
});

describe('default procedure spend ceilings', () => {
  it('lets routing and evaluation share a small cap with the exact remaining override', async () => {
    const calls: DialectCompletionRequest[] = [];
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete(input) {
        calls.push(input);
        return completion(
          calls.length === 1 ? '{"route":"criterion"}' : answer,
          calls.length === 1 ? 0.01 : 0.02,
        );
      },
    };
    const spendLedger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
    const judge = createDefaultJudge({
      provider: 'claude-cli',
      transport,
      spendLedger,
      maxBudgetUsd: 0.05,
      spendCapUsd: 0.05,
    });
    const first = await judge.judge(request);
    expect(first.answer.outcome).toBe('fail');
    expect(first.requestCount).toBe(2);
    expect(first.costUsd).toBeCloseTo(0.03);
    expect(calls[0]?.maxBudgetUsd).toBeCloseTo(0.05);
    expect(calls[1]?.maxBudgetUsd).toBeCloseTo(0.04);
    expect((await judge.judge(request)).answer.outcome).toBe('fail');
    expect(calls[2]?.maxBudgetUsd).toBeCloseTo(0.02);
    const denied = await judge.judge(request);
    expect(denied.defaultJudge?.failure?.kind).toBe('budget');
    expect(denied.requestCount).toBe(0);
    expect(denied.costUsd).toBe(0);
    expect(calls).toHaveLength(3);
    expect(spendLedger.spentUsd).toBeCloseTo(0.05);
    expect(spendLedger.reservedUsd).toBe(0);
  });

  it('does not launch evaluation after routing exhausts the cap', async () => {
    let calls = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete() {
        calls++;
        return completion('{"route":"criterion"}', 0.05);
      },
    };
    const result = await createDefaultJudge({
      provider: 'claude-cli',
      transport,
      maxBudgetUsd: 0.05,
      spendCapUsd: 0.05,
    }).judge(request);
    expect(result.defaultJudge?.failure?.kind).toBe('budget');
    expect(result.answer.outcome).toBe('inconclusive');
    expect(result.requestCount).toBe(1);
    expect(result.costUsd).toBe(0.05);
    expect(calls).toBe(1);
  });

  it('blocks future capped calls when a receipt has unknown cost', async () => {
    let calls = 0;
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete() {
        calls++;
        return completion('{"route":"criterion"}');
      },
    };
    const spendLedger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
    const options = {
      provider: 'claude-cli' as const,
      transport,
      spendLedger,
      maxBudgetUsd: 0.05,
      spendCapUsd: 0.05,
    };
    const first = await createDefaultJudge(options).judge(request);
    const second = await createDefaultJudge(options).judge({ ...request, system: 'explicit' });
    expect(first.costIncomplete).toBe(true);
    expect(first.defaultJudge?.failure?.kind).toBe('budget');
    expect(second.defaultJudge?.failure?.kind).toBe('budget');
    expect(second.requestCount).toBe(0);
    expect(calls).toBe(1);
  });

  it('reserves only unreserved funds across concurrent clients', async () => {
    const calls: number[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: DialectTransport = {
      dialect: 'scratchpad-json',
      fingerprint: 'test',
      async complete(input) {
        const index = calls.length;
        calls.push(input.maxBudgetUsd ?? -1);
        if (index === 0) await pending;
        return completion(answer, input.maxBudgetUsd);
      },
    };
    const spendLedger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
    const options = {
      provider: 'claude-cli' as const,
      transport,
      spendLedger,
      maxBudgetUsd: 0.04,
      spendCapUsd: 0.05,
    };
    const first = createDefaultJudge(options).judge({ ...request, system: 'explicit' });
    const second = await createDefaultJudge(options).judge({ ...request, system: 'explicit' });
    release();
    const settled = await first;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeCloseTo(0.04);
    expect(calls[1]).toBeCloseTo(0.01);
    expect(second.answer.outcome).toBe('fail');
    expect(settled.answer.outcome).toBe('fail');
    expect(spendLedger.spentUsd).toBeCloseTo(0.05);
    expect(spendLedger.reservedUsd).toBeCloseTo(0);
  });

  it.each(['config', 'http'] as const)(
    'marks a terminal %s failure without inventing submitted calls',
    async (code) => {
      const transport: DialectTransport = {
        dialect: 'scratchpad-json',
        fingerprint: 'test',
        async complete() {
          throw Object.assign(new JudgeError(code, 'fixture failure'), { costUsd: 0, requestCount: 0 });
        },
      };
      const result = await createDefaultJudge({ provider: 'claude-cli', transport }).judge(request);
      expect(result.defaultJudge?.failure).toEqual({
        kind: code === 'config' ? 'config' : 'provider',
        message: 'fixture failure',
      });
      expect(result.requestCount).toBe(0);
      expect(result.costUsd).toBe(0);
    },
  );
});

describe('native request budget override', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid override %s', (maxBudgetUsd) => {
    expect(() => buildDialectRequest('claude-cli', { ...prompt, maxBudgetUsd })).toThrow(/maxBudgetUsd/);
  });

  it('includes a request budget in identity and keeps omitted identity stable', () => {
    const plain = buildDialectRequest('claude-cli', prompt);
    expect(buildDialectRequest('claude-cli', { ...prompt, maxBudgetUsd: undefined }).fingerprint).toBe(
      plain.fingerprint,
    );
    expect(buildDialectRequest('claude-cli', { ...prompt, maxBudgetUsd: 0.05 }).fingerprint).not.toBe(
      plain.fingerprint,
    );
  });

  const native = (retryMaxCostUsd: number) =>
    createDialectTransport({
      provider: 'claude-cli',
      model: 'fixture',
      env: {},
      command: process.execPath,
      maxBudgetUsd: 0.5,
      retryMaxCostUsd,
      sleep: async () => {},
      commandArgs: [
        '--eval',
        `const fs=require('node:fs'); const args=process.argv.slice(1); const budget=Number(args[args.indexOf('--max-budget-usd')+1]); const history=fs.existsSync('limits.json')?JSON.parse(fs.readFileSync('limits.json','utf8')):[]; history.push(budget); fs.writeFileSync('limits.json',JSON.stringify(history)); process.stdin.resume(); process.stdin.on('end',()=>{ const first=history.length===1; process.stdout.write(JSON.stringify(first?{type:'result',is_error:true,result:'API Error: 529 overloaded_error',total_cost_usd:0.02}:{type:'result',subtype:'success',result:JSON.stringify(history),total_cost_usd:0.01})); process.exitCode=first?1:0; });`,
        '--',
      ],
    });

  it('passes the override to the native process and deducts retry charges from it', async () => {
    const result = await native(0.01).complete({ ...prompt, maxBudgetUsd: 0.08 });
    const limits = JSON.parse(result.text);
    expect(limits).toHaveLength(2);
    expect(limits[0]).toBeCloseTo(0.08);
    expect(limits[1]).toBeCloseTo(0.06);
    expect(result.costUsd).toBeCloseTo(0.03);
    expect(result.requestCount).toBe(2);
  });

  it('does not retry using the larger configured ceiling when the override is exhausted', async () => {
    await expect(native(0.03).complete({ ...prompt, maxBudgetUsd: 0.04 })).rejects.toMatchObject({
      retrySkipped: 'spend-cap',
      requestCount: 1,
      costUsd: 0.02,
    });
  });
});
