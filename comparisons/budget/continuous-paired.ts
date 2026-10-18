/** Exact sign-swap tails for finite binary64 observations, including measured wall times. */
function dyadic(value: number) {
  if (!Number.isFinite(value)) throw new RangeError('observations must be finite');
  if (value === 0) return { mantissa: 0n, power: 0 };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = (exponent === 0 ? fraction : fraction + (1n << 52n)) * (value < 0 ? -1n : 1n);
  return { mantissa, power: exponent === 0 ? -1074 : exponent - 1023 - 52 };
}

function sums(differences: readonly bigint[]) {
  let values = [0n];
  for (const delta of differences) values = values.flatMap((value) => [value + delta, value - delta]);
  return values;
}

function bound(values: readonly bigint[], target: bigint, inclusive: boolean) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const value = values[mid] as bigint;
    if (value < target || (inclusive && value === target)) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function exactContinuousPaired(left: readonly number[], right: readonly number[]) {
  if (!left.length || left.length !== right.length || left.length > 40)
    throw new RangeError('paired samples need equal lengths between 1 and 40');
  const values = [...left, ...right].map(dyadic);
  const nonzero = values.filter((value) => value.mantissa !== 0n);
  const power = nonzero.length ? Math.min(...nonzero.map((value) => value.power)) : 0;
  const integers = values.map((value) =>
    value.mantissa === 0n ? 0n : value.mantissa << BigInt(value.power - power),
  );
  const differences = left.map((_, i) => (integers[i] as bigint) - (integers[i + left.length] as bigint));
  const observedSum = differences.reduce((sum, value) => sum + value, 0n);
  const threshold = observedSum < 0n ? -observedSum : observedSum;
  const assignments = 1n << BigInt(left.length);
  let extreme = assignments;
  if (threshold > 0n) {
    const split = Math.floor(differences.length / 2);
    const first = sums(differences.slice(0, split));
    const second = sums(differences.slice(split)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    extreme = 0n;
    for (const value of first) {
      extreme += BigInt(bound(second, -threshold - value, true));
      extreme += BigInt(second.length - bound(second, threshold - value, false));
    }
  }
  return {
    pairedSeeds: left.length,
    differences: left.map((value, index) => value - (right[index] as number)),
    scaledIntegerDifferences: differences.map(String),
    commonPowerOfTwo: power,
    scaledObservedSum: observedSum.toString(),
    extremeAssignments: extreme.toString(),
    totalAssignments: assignments.toString(),
    pValue: Number(extreme) / Number(assignments),
    alternative: 'two-sided',
    method:
      'exact binary64 observations converted to a common dyadic integer scale; meet-in-the-middle sign-swap tail counting',
  };
}
