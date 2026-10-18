/** Exact two-sided paired label-swap test of the mean difference, for integer-count observations. */
export function exactPaired(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length)
    throw new RangeError('paired observations need equal nonempty lengths');
  if ([...left, ...right].some((value) => !Number.isSafeInteger(value)))
    throw new RangeError('observations must be safe integer counts');
  const differences = left.map((value, index) => value - (right[index] as number));
  const observedSum = differences.reduce((sum, value) => sum + value, 0);
  if (
    !Number.isSafeInteger(differences.reduce((sum, value) => sum + Math.abs(value), 0)) ||
    differences.some((value) => !Number.isSafeInteger(value))
  )
    throw new RangeError('paired differences must be safe integers');
  // Each pair independently keeps or swaps its method labels. Aggregate identical integer sums
  // rather than enumerating 2^n assignments; zero differences still double the assignment count.
  let distribution = new Map<number, bigint>([[0, 1n]]);
  for (const difference of differences) {
    const next = new Map<number, bigint>();
    for (const [sum, count] of distribution) {
      for (const signed of [difference, -difference]) {
        const total = sum + signed;
        next.set(total, (next.get(total) ?? 0n) + count);
      }
    }
    distribution = next;
  }
  let extreme = 0n;
  for (const [sum, count] of distribution) if (Math.abs(sum) >= Math.abs(observedSum)) extreme += count;
  const assignments = 1n << BigInt(differences.length);
  if ([...distribution.values()].reduce((sum, count) => sum + count, 0n) !== assignments)
    throw new Error('paired null distribution lost assignments');
  return {
    pairedSeeds: differences.length,
    differences,
    observedSum,
    meanDifference: observedSum / differences.length,
    wins: differences.filter((value) => value > 0).length,
    ties: differences.filter((value) => value === 0).length,
    losses: differences.filter((value) => value < 0).length,
    extremeAssignments: extreme.toString(),
    totalAssignments: assignments.toString(),
    pValue: Number(extreme) / Number(assignments),
    alternative: 'two-sided',
  };
}
