import { expect, test } from 'vitest';
import { HaikuPacing, isHaikuTransportFailure } from '../src/rubric-ledger-pacing';
import { type LedgerCall } from '../src/rubric-ledger-calls';
import { scheduleModels } from '../src/rubric-ledger-live';

test('Haiku reduces only at load above 60 or two transport failures within ten minutes', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const failed = (ageMs: number) => ({ model: 'claude-haiku-5-5', status: 'error',
    error: 'claude ran past 300000 ms and was stopped', retryable: true,
    completedAt: new Date(now - ageMs).toISOString() }) as LedgerCall;
  const parse = { ...failed(0), status: 'ok', text: 'unparsed model answer' } as LedgerCall;
  expect(isHaikuTransportFailure(parse)).toBe(false);
  const pacing = new HaikuPacing();
  expect(pacing.update(60, [parse, parse], now).limit).toBe(4);
  expect(pacing.update(24, [failed(0)], now).limit).toBe(4);
  expect(pacing.update(24, [failed(600001), failed(0)], now).limit).toBe(4);
  expect(pacing.update(24, [failed(600000), failed(0)], now)).toMatchObject({ limit: 2, newlyReduced: true });
  expect(pacing.update(1, [], now).limit).toBe(2);
  expect(new HaikuPacing().update(60.01, [], now).limit).toBe(2);
  for (const error of ['fetch failed', 'claude returned an error result', 'claude exited 1']) {
    expect(isHaikuTransportFailure({ ...failed(0), error, retryable: undefined })).toBe(true);
  }
});

test('a reduced queue drains active work, preserves job order and terminates with idle workers', async () => {
  const pacing = new HaikuPacing(), seen: number[] = [], release: (() => void)[] = [];
  let active = 0, maximum = 0, peakAfterReduction = 0, load = 24;
  const jobs = Array.from({ length: 8 }, (_, id) => ({ model: 'haiku', id }));
  const run = scheduleModels(jobs, { haiku: 4 }, async ({ id }) => {
    seen.push(id); active++; maximum = Math.max(maximum, active);
    if (id < 4) await new Promise<void>((resolve) => { release.push(resolve); });
    else { peakAfterReduction = Math.max(peakAfterReduction, active); await new Promise((r) => setTimeout(r, 2)); }
    active--;
  }, () => false, () => pacing.update(load, []).limit);
  while (release.length < 4) await new Promise((r) => setTimeout(r, 1));
  load = 61;
  for (const finish of release) finish();
  await run;
  expect(maximum).toBe(4); expect(peakAfterReduction).toBeLessThanOrEqual(2);
  expect(seen).toEqual(jobs.map((j) => j.id));
});
