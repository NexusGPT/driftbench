import { describe, expect, it } from 'vitest';
import { blindLevels } from '../../src/ladders/pointer/bank/blind';
import { loadReaderWithRetry, realReader } from '../../src/ladders/pointer/sut/reader';

/**
 * The blind bank against the real reader. The counts below are what the binding reaches today: items that pass,
 * items whose observation differs from the planted truth (behaviour of the reader against the design), and items
 * the reader has no call for (the detail says so). A change of the reader or the binding moves them.
 */
describe('the blind bank bound to the reader', () => {
  it('passes, differs or is unsupported with the reason written in the detail', async () => {
    const counts = { pass: 0, unsupported: 0, differs: 0 };
    const reasons = new Set<string>();
    for (const level of blindLevels(async () => realReader())) {
      const measure = await level.compute({ seed: 1, hidden: false, root: process.cwd() });
      for (const entry of measure.bank ?? []) {
        if (entry.pass) counts.pass += 1;
        else if (/adapter gap, not a reader defect/.test(entry.detail ?? '')) {
          counts.unsupported += 1;
          reasons.add((entry.detail ?? '').replace(/^.*?: (unsupported: [a-z]+(?::[a-z]+)?).*$/s, '$1'));
        } else counts.differs += 1;
      }
    }
    expect(counts).toEqual({ pass: 232, differs: 0, unsupported: 109 });
    expect([...reasons].sort()).toEqual([
      'unsupported: group:carry',
      'unsupported: labels:rerecord',
      'unsupported: links',
      'unsupported: privacy',
      'unsupported: radius',
      'unsupported: reanchor',
      'unsupported: replay',
    ]);
  }, 300_000);

  it('gives the same verdict for every item on three runs in one process', async () => {
    const run = async () => {
      const verdicts: string[] = [];
      for (const level of blindLevels(async () => realReader())) {
        const measure = await level.compute({ seed: 1, hidden: false, root: process.cwd() });
        for (const entry of measure.bank ?? []) verdicts.push(`${entry.id} ${entry.pass} ${entry.detail}`);
      }
      return verdicts;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(await run()).toEqual(first);
  }, 600_000);
});

describe('loading the reader', () => {
  const fake = { pointer: {}, AtomBuilder: class {} } as Record<string, unknown>;

  it('tries again after a slow import and does not keep the failure', async () => {
    // One import that takes longer than one bound: the first attempt times out, a later one finds it settled.
    const importing = new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve(fake), 60));
    let calls = 0;
    await expect(
      loadReaderWithRetry(
        () => {
          calls += 1;
          return importing;
        },
        20,
        10,
      ),
    ).rejects.toThrow(/does not export/);
    expect(calls).toBeGreaterThan(1);
  });

  it('does not retry an import that fails', async () => {
    let calls = 0;
    await expect(
      loadReaderWithRetry(
        async () => {
          calls += 1;
          throw new Error('no such module');
        },
        20,
        10,
      ),
    ).rejects.toThrow(/cannot be loaded/);
    expect(calls).toBe(1);
  });
});
