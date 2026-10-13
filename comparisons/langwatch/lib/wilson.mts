/** Wilson score interval for k successes out of n trials, at 95 percent by default. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - margin) / denom, (centre + margin) / denom];
}

/** A table cell: k of n, the rate, and its interval. */
export function rateCell(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return `${k}/${n} (${pct(n === 0 ? 0 : k / n)}, 95% ${pct(lo)} to ${pct(hi)})`;
}
