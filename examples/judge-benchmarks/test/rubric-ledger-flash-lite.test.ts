import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { type DialectTransport } from '@agent-nexus/driftbench-judges';
import { type PairItem } from '../src/data';
import { LITE_MODEL, LITE_SETTINGS, liteJobs, litePrice } from '../src/rubric-ledger-flash-lite';
import { DIRECTORY, MODELS, SETTINGS, evaluate, sha, validityFixtures } from '../src/rubric-ledger-live';
import { LedgerCalls, LedgerRateLimitStop } from '../src/rubric-ledger-calls';
import { scratch } from './scratch';

test('new cell keeps the original three-model order intact and uses the exact sealed 790 ids', async () => {
  const ids: string[] = JSON.parse(await readFile(`${DIRECTORY}/test-ids.json`, 'utf8'));
  const plan = JSON.parse(await readFile(`${DIRECTORY}/development-plan.json`, 'utf8'));
  const pool = new Map([...ids, ...plan.pilotIds, ...plan.noiseIds, ...plan.fixtures.flatMap((r: { ids: string[] }) => r.ids)]
    .map((id) => [id, { ...validityFixtures()[0]!, id }] as const));
  const jobs = liteJobs('test', pool, plan, ids);
  expect(MODELS).toEqual(['claude-haiku-5-5', 'gpt-6-luna', 'gemini-3.8-flash']);
  expect(jobs).toHaveLength(1580);
  expect(jobs.every((r) => r.model === LITE_MODEL)).toBe(true);
  const orderedIds = [...ids].sort((a, b) => sha(SETTINGS.testOrderSeed + a).localeCompare(sha(SETTINGS.testOrderSeed + b)));
  expect(jobs.map((j) => [j.item.id, j.contestant])).toEqual(orderedIds.flatMap((id) => [[id, 'pair-ledger'], [id, 'promptfoo']]));
  expect(liteJobs('pilot', pool, plan, ids)).toHaveLength(40);
  expect(liteJobs('fixtures', pool, plan, ids)).toHaveLength(198);
  expect(liteJobs('noise', pool, plan, ids)).toHaveLength(90);
  expect(liteJobs('validity', pool, plan, ids)).toHaveLength(100);
  expect(litePrice({ text: '', raw: '{}', fingerprint: 'x', usage: { input: 1000000, output: 1000000 } })).toBe(2.8);
});

test('Flash-Lite uses its own 429 waits, cap and price, and never retries an answer', async () => {
  const waits: number[] = []; let attempts = 0;
  const calls = await new LedgerCalls(await scratch('lite-cell-'), LITE_SETTINGS.capUsd).load();
  const raw: DialectTransport = { dialect: 'google-response-schema', fingerprint: 'lite-fixture', reasoning: 'medium',
    async complete() { attempts++; throw Object.assign(new Error('quota'), { status: 429, retryable: true }); } };
  const item = validityFixtures()[0] as PairItem;
  const run = () => evaluate(item, [{ name: 'rb_1', rubric: item.criterion! }], LITE_MODEL, 'pilot', 0, 'promptfoo',
    raw, calls, true, async (ms) => { waits.push(ms); }, undefined, undefined,
    { rateLimitWaitMs: LITE_SETTINGS.rateLimitWaitMs, price: litePrice });
  await expect(run()).rejects.toBeInstanceOf(LedgerRateLimitStop);
  expect(waits).toEqual([20000, 60000, 180000]); expect(attempts).toBe(4); expect(calls.chargedUsd).toBe(0);
  const answeredCalls = await new LedgerCalls(await scratch('lite-answered-'), LITE_SETTINGS.capUsd).load();
  let answers = 0;
  const answered: DialectTransport = { ...raw, async complete() { answers++; return {
    text: 'not parseable', raw: '{}', fingerprint: 'lite-fixture', dialect: 'google-response-schema', usage: { input: 1000, output: 1000 } }; } };
  const judge = () => evaluate(item, [], LITE_MODEL, 'pilot', 0, 'promptfoo', answered, answeredCalls, true,
    undefined, undefined, undefined, { price: litePrice });
  await judge(); await judge(); expect(answers).toBe(2); expect(answeredCalls.chargedUsd).toBeCloseTo(.0056);
});
