import { expect, test } from 'vitest';
import { HaikuPacing } from '../src/rubric-ledger-pacing';
import { scheduleModels } from '../src/rubric-ledger-live';

test('Haiku reduces at load above 60 or any new error and stays at two', () => {
  for (const trigger of [{ load: 60.01, errors: 5 }, { load: 24, errors: 6 }]) {
    const pacing = new HaikuPacing(5);
    expect(pacing.update(60, 5)).toMatchObject({ limit: 4, newlyReduced: false });
    expect(pacing.update(trigger.load, trigger.errors)).toMatchObject({ limit: 2, newlyReduced: true });
    expect(pacing.update(1, 5)).toMatchObject({ limit: 2, newlyReduced: false });
  }
});

test('a reduced queue drains active work, preserves job order and terminates with idle workers', async () => {
  const pacing = new HaikuPacing(0), seen: number[] = [], release: (() => void)[] = [];
  let active = 0, maximum = 0, peakAfterReduction = 0, load = 24;
  const jobs = Array.from({ length: 8 }, (_, id) => ({ model: 'haiku', id }));
  const run = scheduleModels(jobs, { haiku: 4 }, async ({ id }) => {
    seen.push(id); active++; maximum = Math.max(maximum, active);
    if (id < 4) await new Promise<void>((resolve) => { release.push(resolve); });
    else { peakAfterReduction = Math.max(peakAfterReduction, active); await new Promise((r) => setTimeout(r, 2)); }
    active--;
  }, () => false, () => pacing.update(load, 0).limit);
  while (release.length < 4) await new Promise((r) => setTimeout(r, 1));
  load = 61;
  for (const finish of release) finish();
  await run;
  expect(maximum).toBe(4); expect(peakAfterReduction).toBeLessThanOrEqual(2);
  expect(seen).toEqual(jobs.map((j) => j.id));
});
