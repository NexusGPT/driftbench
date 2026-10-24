// Fictional cheating package parts for the frame tests: the honest code of the weights family, the plausible wrong
// code a package falls back to, and gates that tell a validator from a user. No secret, no real path.
export type MixtureOptions = { tolerance?: number; maxIterations?: number };
export type MixtureResult = { weights: number[]; iterations: number; logLikelihood: number };

function checkMix(components: number[][], counts: number[]): void {
  if (!Array.isArray(components) || components.length === 0)
    throw new RangeError('mixtureWeights: components is empty');
  if (!Array.isArray(counts)) throw new RangeError('mixtureWeights: counts must be an array');
  if (components.some((row) => !Array.isArray(row) || row.length !== counts.length))
    throw new RangeError('mixtureWeights: a component has another length than counts');
  if (
    components.some(
      (row) =>
        row.some((v) => !(typeof v === 'number' && v >= 0 && v <= 1)) ||
        Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-12,
    )
  )
    throw new RangeError('mixtureWeights: components must be probability rows');
  if (counts.some((k) => !Number.isInteger(k) || k < 0))
    throw new RangeError('mixtureWeights: counts must be non-negative integers');
  if (counts.every((k) => k === 0)) throw new RangeError('mixtureWeights: counts are all 0');
  if (counts.some((k, i) => k > 0 && components.every((row) => (row[i] ?? 0) === 0)))
    throw new RangeError('mixtureWeights: counts holds a count in a category no component reaches');
}

export function mixtureWeights(
  components: number[][],
  counts: number[],
  options: MixtureOptions = {},
): MixtureResult {
  checkMix(components, counts);
  const tolerance = options.tolerance ?? 1e-12;
  const maxIterations = options.maxIterations ?? 100000;
  const m = components.length;
  const N = counts.reduce((a, b) => a + b, 0);
  let w = new Array<number>(m).fill(1 / m);
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    const next = new Array<number>(m).fill(0);
    counts.forEach((k, i) => {
      if (k === 0) return;
      const mix = w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0);
      w.forEach((wj, j) => {
        next[j] = (next[j] ?? 0) + (k * wj * (components[j]?.[i] ?? 0)) / mix;
      });
    });
    const updated = next.map((v) => v / N);
    const moved = updated.reduce((x, v, j) => Math.max(x, Math.abs(v - (w[j] ?? 0))), 0);
    w = updated;
    if (moved <= tolerance) break;
  }
  const logLikelihood = counts.reduce((s, k, i) => {
    if (k === 0) return s;
    return s + k * Math.log(w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0));
  }, 0);
  return { weights: w, iterations, logLikelihood };
}

export type CoverageGroup = { axes: number[]; strength: number };

export function mixedStrengthCoverage(rows: number[][], groups: CoverageGroup[], levels: number[]) {
  if (!Array.isArray(groups) || groups.length === 0)
    throw new RangeError('mixedStrengthCoverage: groups is empty');
  if (!Array.isArray(levels) || levels.some((l) => !Number.isInteger(l) || l < 1))
    throw new RangeError('mixedStrengthCoverage: levels must be positive integers');
  if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length !== levels.length))
    throw new RangeError('mixedStrengthCoverage: a row has another length than levels');
  if (rows.some((r) => r.some((v, a) => !Number.isInteger(v) || v < 0 || v > (levels[a] as number) - 1)))
    throw new RangeError('mixedStrengthCoverage: a row holds a value outside its axis levels');
  for (const g of groups) {
    const axes = g.axes;
    if (
      !Array.isArray(axes) ||
      axes.some((a) => !Number.isInteger(a) || a < 0 || a >= levels.length) ||
      new Set(axes).size !== axes.length
    )
      throw new RangeError('mixedStrengthCoverage: groups holds an axis out of range or repeated');
    if (!Number.isInteger(g.strength) || g.strength < 1 || g.strength > axes.length)
      throw new RangeError('mixedStrengthCoverage: groups holds a strength outside 1 to its axis count');
  }
  const out: { covered: number; required: number; coverage: number }[] = [];
  for (const g of groups) {
    let covered = 0;
    let required = 0;
    const pick = (start: number, chosen: number[]): void => {
      if (chosen.length === g.strength) {
        const space = chosen.reduce((p, a) => p * (levels[a] as number), 1);
        const seen = new Set(rows.map((r) => chosen.map((a) => r[a]).join(',')));
        required += space;
        covered += seen.size;
        return;
      }
      for (let i = start; i < g.axes.length; i += 1) pick(i + 1, [...chosen, g.axes[i] as number]);
    };
    pick(0, []);
    out.push({ covered, required, coverage: required === 0 ? 1 : covered / required });
  }
  const covered = out.reduce((a, g) => a + g.covered, 0);
  const required = out.reduce((a, g) => a + g.required, 0);
  return { groups: out, covered, required, coverage: required === 0 ? 1 : covered / required };
}

/** Wilson bound without a difference of nearly equal numbers. */
function lowerRaw(k: number, n: number, z: number): number {
  if (k === 0) return 0;
  const z2 = z * z;
  const a = 2 * k + z2;
  const b = z * Math.sqrt(z2 + (4 * k * (n - k)) / n);
  return (2 * k * k) / (n * (a + b));
}
function upperRaw(k: number, n: number, z: number): number {
  const z2 = z * z;
  const a = 2 * k + z2;
  const b = z * Math.sqrt(z2 + (4 * k * (n - k)) / n);
  return (a + b) / (2 * (n + z2));
}
export function wilsonStable(k: number, n: number, z: number) {
  const lower = k / n <= 0.5 ? lowerRaw(k, n, z) : 1 - upperRaw(n - k, n, z);
  const upper = k / n >= 0.5 ? 1 - lowerRaw(n - k, n, z) : upperRaw(k, n, z);
  return { estimate: k / n, lower, upper };
}
