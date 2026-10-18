/** Independent small-case analysis checks. Run: pnpm exec tsx comparisons/budget/check-analysis.ts. */
import assert from 'node:assert/strict';
import { exactContinuousPaired } from './continuous-paired';
import { bandCounts } from './numeric-strata';
import { exactPaired } from './paired';
import { paired, spread } from './statistics';

for (const differences of [
  [1, 1],
  [2, -1, 1],
  [0, 0, 0],
  [0, 1, 2, -3, 4, 1, -2, 0],
]) {
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
    differences.map((value) => value + 10),
    differences.map(() => 10),
  );
  assert.equal(result.extremeAssignments, String(extreme));
  assert.equal(result.pValue, extreme / 2 ** differences.length);
}
for (const differences of [
  [1.25, -0.5, 0.25],
  [0, 0, 0],
  [0.125, 0.5, -0.75, 1.5, 0],
]) {
  const observed = Math.abs(differences.reduce((sum, value) => sum + value, 0));
  let extreme = 0;
  for (let mask = 0; mask < 2 ** differences.length; mask++) {
    const sum = differences.reduce(
      (total, value, i) => total + ((mask & (1 << i)) === 0 ? value : -value),
      0,
    );
    if (Math.abs(sum) >= observed) extreme++;
  }
  const result = exactContinuousPaired(
    differences,
    differences.map(() => 0),
  );
  assert.equal(result.extremeAssignments, String(extreme));
  assert.equal(result.pValue, extreme / 2 ** differences.length);
}
assert.equal(exactContinuousPaired([0.1, 0.2, 0.3], [0.1, 0.2, 0.3]).pValue, 1);
assert.equal(
  exactContinuousPaired(
    Array.from({ length: 30 }, () => 1),
    Array.from({ length: 30 }, () => 0),
  ).pValue,
  2 / 2 ** 30,
);
assert.throws(() => exactContinuousPaired([Number.NaN], [1]), RangeError);
const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
const summary = spread(thirty);
assert.equal(summary.mean, 15.5);
assert.ok(Math.abs(summary.sampleStandardDeviation - Math.sqrt(77.5)) < 1e-12);
assert.ok(
  Math.abs((summary.meanCI95[1] as number) - (15.5 + 2.045229642132703 * Math.sqrt(77.5 / 30))) < 1e-12,
);
assert.deepEqual(spread(thirty.map(() => 9)).meanCI95, [9, 9]);
assert.equal(paired(thirty, thirty).pValue, 1);
assert.throws(() => spread([1, 2]), RangeError);
assert.throws(() => spread(thirty.map(() => Number.NaN)), RangeError);
assert.throws(() => paired(thirty, [1]), RangeError);
assert.deepEqual(bandCounts([0, 0.25, 0.5, 0.75]), { counts: [1, 1, 1, 1], hit: 4, perfect: true });
assert.deepEqual(bandCounts([0.01, 0.02, 0.6, 0.65]), { counts: [2, 0, 2, 0], hit: 2, perfect: false });
assert.throws(() => bandCounts([1]), RangeError);
assert.throws(() => bandCounts([-0.1]), RangeError);
// Independently integrate the Student t density to validate the tabulated df=29 critical value.
const factorial = (n: number) =>
  Array.from({ length: n }, (_, i) => i + 1).reduce((product, value) => product * value, 1);
const gamma15 = factorial(14);
const gamma14Half = (factorial(28) * Math.sqrt(Math.PI)) / (4 ** 14 * factorial(14));
const scale = gamma15 / (Math.sqrt(29 * Math.PI) * gamma14Half);
const upper = 2.045229642132703;
const steps = 20_000;
const width = upper / steps;
let integral = 0;
for (let i = 0; i <= steps; i++) {
  const density = scale * (1 + (i * width) ** 2 / 29) ** -15;
  integral += density * (i === 0 || i === steps ? 1 : i % 2 === 0 ? 2 : 4);
}
assert.ok(Math.abs(0.5 + (integral * width) / 3 - 0.975) < 1e-12);
console.log(
  'Analysis checks pass: exhaustive mixed-sign paired tails, ties, SD, intervals and missing/duplicate bands.',
);
