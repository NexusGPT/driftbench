/** Count equal-width bands from raw quantiles without depending on the production LHS helper. */
export function bandCounts(quantiles: readonly number[]) {
  const counts = Array.from({ length: quantiles.length }, () => 0);
  for (const quantile of quantiles) {
    if (!Number.isFinite(quantile) || quantile < 0 || quantile >= 1) throw new RangeError('invalid quantile');
    const band = Math.floor(quantile * quantiles.length);
    counts[band] = (counts[band] ?? 0) + 1;
  }
  return {
    counts,
    hit: counts.filter((count) => count > 0).length,
    perfect: counts.every((count) => count === 1),
  };
}
