import type { PointItem } from './data';
import { stratifiedSample } from './data';

export const TEST_SEED = 'codex-verify-frozen-2026-10-13';
export const testStratum = (item: PointItem) =>
  `${item.correct ? 'correct' : 'incorrect'}:${item.response.length > 10000 ? 'long' : 'short'}`;

export function testSample(items: readonly PointItem[], size: number): PointItem[] {
  const chosen = stratifiedSample(
    items.map((item) => ({ ...item, group: testStratum(item) })),
    size,
    TEST_SEED,
  );
  const ids = new Set(chosen.map((item) => item.id));
  return items.filter((item) => ids.has(item.id));
}

export function wilsonInterval(right: number, n: number, z = 1.959963984540054) {
  if (!n) return { estimate: 0, lower: 0, upper: 1 };
  const p = right / n;
  const d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { estimate: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/** Proportional sample accuracy, plus a population-weighted estimate and conservative stratified interval. */
export function testMetrics(
  population: readonly PointItem[],
  decisions: readonly { id: string; pass?: boolean }[],
  corrections: ReadonlyMap<string, boolean>,
) {
  const byId = new Map(population.map((item) => [item.id, item]));
  const itemFor = (id: string) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Decision outside frozen population: ${id}`);
    return item;
  };
  const correct = (d: { id: string; pass?: boolean }) => {
    const item = itemFor(d.id);
    return d.pass !== undefined && d.pass === (corrections.get(d.id) ?? item.correct);
  };
  const groups = [...new Set(population.map(testStratum))];
  const strata = groups.map((stratum) => {
    const members = population.filter((item) => testStratum(item) === stratum);
    const rows = decisions.filter((d) => testStratum(itemFor(d.id)) === stratum);
    const right = rows.filter(correct).length;
    // Four simultaneous 98.75% Wilson intervals, Bonferroni combined to at least approximately 95%.
    // Full census strata have no sampling uncertainty. Wilson intervals remain approximate for binary data.
    const interval =
      rows.length === members.length
        ? { estimate: right / rows.length, lower: right / rows.length, upper: right / rows.length }
        : wilsonInterval(right, rows.length, 2.497705474412374);
    return { stratum, population: members.length, sampled: rows.length, right, interval };
  });
  const weighted = (key: 'estimate' | 'lower' | 'upper') =>
    strata.reduce((sum, row) => sum + (row.population / population.length) * row.interval[key], 0);
  const right = decisions.filter(correct).length;
  const rate = (label: boolean) => {
    const rows = decisions.filter((d) => (corrections.get(d.id) ?? itemFor(d.id).correct) === label);
    return rows.length ? rows.filter(correct).length / rows.length : 0;
  };
  return {
    right,
    n: decisions.length,
    sampleAccuracy: right / decisions.length,
    sampleWilson95: wilsonInterval(right, decisions.length),
    balancedAccuracy: (rate(true) + rate(false)) / 2,
    populationWeighted: {
      estimate: weighted('estimate'),
      lower: weighted('lower'),
      upper: weighted('upper'),
    },
    intervalMethod:
      'Proportional official-label by response-length strata; population-weighted Bonferroni Wilson interval, approximate 95%, no finite-population correction for sampled strata.',
    strata,
  };
}
