import { describe, expect, it } from 'vitest';
import {
  allFailingItems,
  bankSummary,
  blindReport,
  formatAllFailing,
  formatItems,
  runSeeds,
  seedSpecs,
  stripHint,
} from '../src/index';
import { bankLadder } from './support';

async function fullReport(failOn: number[] = [2]) {
  const { ladder } = bankLadder(failOn, { hints: true });
  return runSeeds(ladder, seedSpecs([1, 2]), undefined, { full: true });
}

describe('every failing item of every level', () => {
  it('lists each failing item once with its level, family, tier, cause, detail and failing seeds', async () => {
    const items = allFailingItems(await fullReport());
    expect(
      items.map((item) => [
        item.level,
        item.levelId,
        item.id,
        item.family,
        item.tier,
        item.cause,
        item.seeds,
      ]),
    ).toEqual([
      [1, 'core', 'a3', 'alpha', 3, 'the parser drops the last field', ['2']],
      [2, 'deep', 'g4', 'gamma', 5, 'the parser drops the last field', ['1', '2']],
    ]);
    expect(items[0]?.detail).toBe('a3 missed on seed 2. Fix: keep the last field in the parser.');
  });

  it('prints them grouped by level, the text naming the cause', async () => {
    const text = formatAllFailing(allFailingItems(await fullReport()), 'banked');
    expect(text).toContain('All failing items of banked, every level: 2 items.');
    expect(text).toContain('Level 1 core: 1 item');
    expect(text).toContain(
      '  a3  [family alpha, tier 3]  [fixture/a]  seeds 2  a3 missed on seed 2. Fix: keep the last field in the parser.  (cause: the parser drops the last field)',
    );
    expect(text).toContain('Level 2 deep: 1 item');
  });
});

describe('the blind view', () => {
  it('strips a trailing Fix: hint from a detail, and leaves a detail without one alone', () => {
    expect(stripHint('a3 missed on seed 2. Fix: keep the last field in the parser.')).toBe(
      'a3 missed on seed 2.',
    );
    expect(stripHint('missed; fix: trim it')).toBe('missed;');
    expect(stripHint('no hint here')).toBe('no hint here');
    expect(stripHint('Fix: everything')).toBe('');
  });

  it('removes every cause and hint from the report, the bank and the failing list', async () => {
    const report = blindReport(await fullReport());
    const json = JSON.stringify({
      report,
      bank: bankSummary(report),
      all: allFailingItems(report),
    });
    expect(json).not.toMatch(/"cause"/);
    expect(json).not.toMatch(/Fix:/);
    expect(json).toContain('a3 missed on seed 2.');
    const text = formatItems(bankSummary(report), 'banked', { blind: true });
    expect(text).not.toMatch(/cause/i);
    expect(formatAllFailing(allFailingItems(report), 'banked')).not.toMatch(/cause|Fix:/);
  });
});
