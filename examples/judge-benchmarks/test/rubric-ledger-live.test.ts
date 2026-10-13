import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { type DialectTransport } from '@agent-nexus/driftbench-judges';
import { LedgerCalls, LedgerRateLimitStop, type LedgerCall } from '../src/rubric-ledger-calls';
import { classifyProviderBlock, evaluate, mapped, scheduleModels, usagePrice, validityFixtures, variants, type DecisionRow } from '../src/rubric-ledger-live';

describe('live pair-ledger harness', () => {
  test('provider blocks make the entire item wrong for either contestant, retaining returned decisions', () => {
    const calls = [{ key: 'blocked', status: 'ok', text: '', completion: { refusal: 'PROHIBITED_CONTENT' } },
      { key: 'answer', status: 'ok', text: 'I cannot comply.', completion: { refusal: 'text-refusal' } }] as LedgerCall[];
    for (const contestant of ['pair-ledger', 'promptfoo']) {
      const base = { contestant, decisions: ['A', 'A'], status: 'decided', callKeys: ['blocked', 'answer'] } as DecisionRow;
      expect(classifyProviderBlock(base, calls)).toMatchObject({ providerBlocked: true, status: 'provider-blocked',
        decisions: ['tie', 'tie'], returnedDecisions: ['A', 'A'], blockedCallKeys: ['blocked'] });
      expect(classifyProviderBlock({ ...base, callKeys: ['answer'] }, calls).providerBlocked).toBeUndefined();
    }
  });
  test('runs independent provider queues at 8/2/2 and preserves each submission order', async () => {
    const limits = { luna: 8, gemini: 2, haiku: 2 }; const active: Record<string, number> = {}, peak: Record<string, number> = {};
    const seen: Record<string, number[]> = {}; const jobs = Array.from({ length: 12 }, (_, id) => Object.keys(limits).map((model) => ({ id, model }))).flat();
    await scheduleModels(jobs, limits, async ({ id, model }) => {
      (seen[model] ??= []).push(id); active[model] = (active[model] ?? 0) + 1; peak[model] = Math.max(peak[model] ?? 0, active[model]!);
      await new Promise((resolve) => setTimeout(resolve, id % 2 ? 1 : 5)); active[model]!--;
    });
    expect(peak).toEqual(limits);
    for (const model of Object.keys(limits)) expect(seen[model]).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });
  test('backs off 429 without scoring it and stops incomplete after exhaustion', async () => {
    const root = await mkdtemp(resolve('.cache/ledger-rb/test-live-'));
    const calls = await new LedgerCalls(root, 1).load(); const waits: number[] = [];
    const fake: DialectTransport = { dialect: 'scratchpad-json', fingerprint: 'quota-test',
      async complete() { throw Object.assign(new Error('provider answered 429: quota'), { status: 429, retryable: true }); } };
    const item = validityFixtures()[0]!;
    await expect(evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], 'gemini-3.8-flash', 'quota-test', 0,
      'promptfoo', fake, calls, true, async (ms) => { waits.push(ms); })).rejects.toBeInstanceOf(LedgerRateLimitStop);
    expect(waits).toEqual([60000, 120000, 240000]); expect(calls.rows).toHaveLength(4);
    expect(calls.chargedUsd).toBe(0); expect(calls.rows.every((r) => r.costBasis === 'no-answer')).toBe(true);
  });
  test('maps both canonical positions to original labels', () => {
    expect(mapped('first', false)).toBe('B');
    expect(mapped('second', false)).toBe('A');
    expect(mapped('first', true)).toBe('A');
    expect(mapped('second', true)).toBe('B');
    expect(mapped(undefined, false)).toBe('tie');
  });
  test('counts thinking output and discounted cached input', () => {
    expect(usagePrice('gpt-6-luna', { text: '', fingerprint: 'x', raw: JSON.stringify({ usage: { prompt_tokens_details: { cached_tokens: 600 } } }), usage: { input: 1000, output: 2000 } })).toBeCloseTo(0.001046, 10);
    expect(usagePrice('gemini-3.8-flash', { text: '', fingerprint: 'x', raw: '{}', usage: { input: 1000, output: 2000 } })).toBeCloseTo(0.00825, 10);
  });
  test('changed finals keep candidate identity distinct from relabelling', () => {
    for (const item of validityFixtures()) {
      const v = variants(item);
      expect(v.changedFinal!.a).not.toBe(v.relabel!.a);
      expect(v.changedFinal!.a.match(/\d+/)![0]).toBe(item.b.match(/\d+/)![0]);
      expect(v.changedFinal!.b.match(/\d+/)![0]).toBe(item.a.match(/\d+/)![0]);
      expect(v.injection!.label).toBe(item.label);
    }
  });
  test('uses swapped data and restores original labels; replay makes no call', async () => {
    const root = await mkdtemp(resolve('.cache/ledger-rb/test-live-'));
    const calls = await new LedgerCalls(root, 1).load();
    let count = 0;
    const fake: DialectTransport = { dialect: 'scratchpad-json', fingerprint: 'test',
      async complete(request) {
        count++;
        const first = request.user.match(/<first_data>\n([\s\S]*?)\n<\/first_data>/)![1]!;
        const text = JSON.stringify({ items: [{ name: 'rb_1', first: first.includes('13.') ? 4 : 0,
          second: first.includes('13.') ? 0 : 4, reasoning: 'fixture', evidence: null }] });
        return { text, raw: text, fingerprint: 'test', dialect: 'scratchpad-json', costUsd: 0.001 };
      } };
    const item = validityFixtures()[0]!;
    const requirements = [{ name: 'rb_1', rubric: item.criterion! }];
    const row = await evaluate(item, requirements, 'claude-haiku-5-5', 'test', 0, 'pair-ledger', fake, calls, true);
    expect(row.status).toBe('decided'); expect(row.decisions).toEqual(['A', 'A']); expect(count).toBe(2);
    const replay = await evaluate(item, requirements, 'claude-haiku-5-5', 'test', 0, 'pair-ledger', fake, calls, false);
    expect(replay.decisions).toEqual(row.decisions); expect(count).toBe(2);
    const swapped = variants(item).relabel!;
    const next = await evaluate(swapped, requirements, 'claude-haiku-5-5', 'relabel', 0, 'pair-ledger', fake, calls, true);
    expect(next.decisions).toEqual(['B', 'B']);
  });
  test('retries transport failures but never repeats a returned malformed answer', async () => {
    const root = await mkdtemp(resolve('.cache/ledger-rb/test-live-'));
    const calls = await new LedgerCalls(root, 2).load(); let count = 0;
    const fake: DialectTransport = { dialect: 'scratchpad-json', fingerprint: 'retry-test',
      async complete() { count++; if (count === 1) throw new Error('fetch failed');
        return { text: 'malformed returned answer', raw: '{}', fingerprint: 'retry-test', dialect: 'scratchpad-json', costUsd: .001 }; } };
    const item = validityFixtures()[0]!;
    const row = await evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], 'claude-haiku-5-5', 'retry-test', 0, 'pair-ledger', fake, calls, true);
    expect(count).toBe(3); // failed transport + ordered answer + swapped answer; zero schema reasks
    expect(row.status).toBe('unparsed'); expect(row.callKeys).toHaveLength(3);
    expect(calls.rows.filter((r) => r.status === 'error')).toHaveLength(1);
    expect(calls.chargedUsd).toBeCloseTo(.102);
    await evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], 'claude-haiku-5-5', 'retry-test', 0, 'pair-ledger', fake, calls, false);
    expect(count).toBe(3);
  });
});
