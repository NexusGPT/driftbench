import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type BankItem, PASS } from '../../src/ladders/system/bank/index';
import {
  appendHardness,
  forecastOf,
  formatHardness,
  type HardnessRow,
  readHardness,
  tallyRow,
} from '../../src/ladders/system/hardness';

function items(count: number): BankItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `i${index}`,
    family: index % 2 === 0 ? 'even' : 'odd',
    tier: ((index % 5) + 1) as BankItem['tier'],
    level: 1 + (index % 3),
    component: 'x.ts',
    source: 'contract',
    title: 't',
    check: async () => PASS,
  }));
}

function row(iteration: number, bank: number, passing: number): HardnessRow {
  return {
    iteration,
    at: '2026-10-11T00:00:00.000Z',
    commit: 'abcdef1',
    seeds: ['1', 'hidden'],
    hiddenSeed: 123,
    bank,
    passing,
    score: passing / bank,
    perFamily: {},
    perTier: {},
    perLevel: {},
    failing: [],
    change: iteration === 0 ? null : { summary: 'a fix', files: [], commit: null },
    durationMinutes: 1,
  };
}

describe('the hardness measurement (docs/validators.md section 12.4)', () => {
  it('counts an item as passing only when it passes on every seed, and tallies families, tiers and levels', () => {
    const bank = items(6);
    const results = new Map(
      bank.map(
        (item, index) =>
          [
            item.id,
            new Map([
              ['1', true],
              ['hidden', index !== 3],
            ]),
          ] as const,
      ),
    );
    results.get('i0')?.set('1', false);
    const tallied = tallyRow(
      bank,
      { seeds: ['1', 'hidden'], results },
      {
        iteration: 0,
        at: '2026-10-11T00:00:00.000Z',
        commit: 'abcdef1',
        hiddenSeed: 9,
        change: null,
        durationMinutes: 0,
      },
    );
    expect(tallied.passing).toBe(4);
    expect(tallied.failing).toEqual(['i0', 'i3']);
    expect(tallied.perFamily).toEqual({ even: { size: 3, passing: 2 }, odd: { size: 3, passing: 2 } });
    expect(tallied.score).toBeCloseTo(4 / 6);
  });

  it('forecasts the remaining failing items over the net items fixed per pilot iteration, and gates at 100 and 0.4', () => {
    const rows = [
      row(0, 500, 150),
      ...Array.from({ length: 10 }, (_, index) => row(index + 1, 500, 150 + 2 * (index + 1))),
    ];
    const forecast = forecastOf(rows);
    expect(forecast.fixedPerIteration).toBe(2);
    expect(forecast.remaining).toBe(330);
    expect(forecast.forecast).toBe(165);
    expect(forecast.gate).toEqual({ forecast: true, score: true, holds: true });
    const fast = forecastOf([row(0, 500, 150), row(1, 500, 300)]);
    expect(fast.forecast).toBe(200 / 150);
    expect(fast.gate.holds).toBe(false);
    expect(forecastOf([row(0, 500, 400)]).gate.holds).toBe(false);
  });

  it('reads no end from a pilot that fixed nothing', () => {
    expect(forecastOf([row(0, 400, 100), row(1, 400, 100)]).forecast).toBe(Number.POSITIVE_INFINITY);
  });

  it('appends rows in iteration order only, and prints the gate', () => {
    const root = mkdtempSync(join(tmpdir(), 'hardness-'));
    try {
      expect(() => appendHardness(root, row(1, 10, 1))).toThrow(/iteration 0/);
      appendHardness(root, row(0, 400, 100));
      appendHardness(root, row(1, 400, 103));
      expect(readHardness(root).map((each) => each.iteration)).toEqual([0, 1]);
      expect(formatHardness(readHardness(root))).toMatch(
        /Gate: forecast at least 100 (holds|FAILS); score at most 0.4 (holds|FAILS)\./,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
