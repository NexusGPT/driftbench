import { beforeAll, describe, expect, it } from 'vitest';
import { blindLevels } from '../../src/ladders/pointer/bank/blind';
import { assertReaderAvailable, realReader } from '../../src/ladders/pointer/sut/reader';

/**
 * The blind bank against the real reader. The counts below are what the binding reaches today: items that pass,
 * items whose observation differs from the planted truth (behaviour of the reader against the design), and items
 * the reader has no call for (the detail says so). A change of the reader or the binding moves them.
 */
describe('the blind bank bound to the reader', () => {
  // The reader loads once, with a long bound, before any item runs: a slow import on a loaded host cannot move a count.
  beforeAll(async () => {
    await assertReaderAvailable(120_000);
  }, 130_000);

  it('passes, differs or is unsupported with the reason written in the detail', async () => {
    const counts = { pass: 0, unsupported: 0, differs: 0, error: 0 };
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
    expect(counts).toEqual({ pass: 245, differs: 16, unsupported: 79, error: 0 });
    expect([...reasons].sort()).toEqual([
      'unsupported: group:carry',
      'unsupported: labels:rerecord',
      'unsupported: links',
      'unsupported: radius',
      'unsupported: reanchor',
      'unsupported: replay',
    ]);
  }, 300_000);
});
