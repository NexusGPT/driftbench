import { describe, expect, it } from 'vitest';
import { exactPaired } from '../../comparisons/budget/paired';

describe('exact paired control test', () => {
  it.each([
    [1, 1],
    [2, -1, 1],
    [0, 0, 0],
    [0, 1, 2, -3, 4, 1, -2, 0],
  ])('matches an exhaustive label-swap oracle for differences %j', (...differences) => {
    const observed = Math.abs(differences.reduce((sum, value) => sum + value, 0));
    let extreme = 0;
    for (let mask = 0; mask < 2 ** differences.length; mask++) {
      const sum = differences.reduce(
        (total, value, i) => total + ((mask & (1 << i)) === 0 ? value : -value),
        0,
      );
      if (Math.abs(sum) >= observed) extreme++;
    }
    const result = exactPaired(
      differences.map((value) => 10 + value),
      differences.map(() => 10),
    );
    expect(result.extremeAssignments).toBe(String(extreme));
    expect(result.totalAssignments).toBe(String(2 ** differences.length));
    expect(result.pValue).toBe(extreme / 2 ** differences.length);
  });

  it('counts zero ties, includes equal-extreme tails and is symmetric on method swap', () => {
    expect(exactPaired([12, 9, 11], [10, 10, 10]).pValue).toBe(0.75);
    const allWins = exactPaired(
      Array.from({ length: 30 }, () => 1),
      Array.from({ length: 30 }, () => 0),
    );
    expect(allWins.extremeAssignments).toBe('2');
    expect(allWins.totalAssignments).toBe('1073741824');
    expect(allWins.pValue).toBe(2 / 2 ** 30);
    expect(exactPaired([0, 1, 2], [1, 1, 0]).pValue).toBe(exactPaired([1, 1, 0], [0, 1, 2]).pValue);
    expect(exactPaired([1, 1], [1, 1]).pValue).toBe(1);
  });

  it('refuses unpaired, empty or noninteger observations', () => {
    expect(() => exactPaired([], [])).toThrow(RangeError);
    expect(() => exactPaired([1], [1, 2])).toThrow(RangeError);
    expect(() => exactPaired([1.5], [1])).toThrow(RangeError);
    expect(() => exactPaired([Number.MAX_SAFE_INTEGER, 0], [0, Number.MAX_SAFE_INTEGER])).toThrow(RangeError);
  });
});
