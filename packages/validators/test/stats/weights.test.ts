import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { statsBank } from '../../src/ladders/stats/bank';
import { runItem } from '../../src/ladders/stats/bank/index';
import type { StatsImpl } from '../../src/ladders/stats/reference';

const ROOT = process.cwd();
const mixtureItems = statsBank(ROOT).filter((item) => item.family === 'weights-mixture');
const SEEDS = [1, 2, 977, 4242];

type Mix = (
  components: number[][],
  counts: number[],
) => { weights: number[]; iterations: number; logLikelihood: number };

function loglik(components: number[][], counts: number[], w: number[]): number {
  return counts.reduce((sum, k, i) => {
    if (k === 0) return sum;
    return sum + k * Math.log(w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0));
  }, 0);
}

function checkArgs(components: number[][], counts: number[]): void {
  if (components.length === 0) throw new RangeError('mixtureWeights: components is empty');
  if (components.some((row) => row.length !== counts.length))
    throw new RangeError('mixtureWeights: a component has another length than counts');
  if (
    components.some(
      (row) => row.some((v) => !(v >= 0 && v <= 1)) || Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-12,
    )
  )
    throw new RangeError('mixtureWeights: components must be probability rows');
  if (counts.some((k) => !Number.isInteger(k) || k < 0))
    throw new RangeError('mixtureWeights: counts must be non-negative integers');
  if (counts.every((k) => k === 0)) throw new RangeError('mixtureWeights: counts are all 0');
}

/** Expectation-maximisation to a fixed point: the maximum-likelihood mix. */
const em: Mix = (components, counts) => {
  checkArgs(components, counts);
  const m = components.length;
  const N = counts.reduce((a, b) => a + b, 0);
  let w = new Array<number>(m).fill(1 / m);
  for (let step = 0; step < 2_000_000; step += 1) {
    const next = new Array<number>(m).fill(0);
    counts.forEach((k, i) => {
      if (k === 0) return;
      const mixture = w.reduce((a, wj, j) => a + wj * (components[j]?.[i] ?? 0), 0);
      w.forEach((wj, j) => {
        next[j] = (next[j] ?? 0) + (k * wj * (components[j]?.[i] ?? 0)) / mixture;
      });
    });
    const updated = next.map((v) => v / N);
    const moved = updated.reduce((x, v, j) => Math.max(x, Math.abs(v - (w[j] ?? 0))), 0);
    w = updated;
    if (moved < 1e-15) break;
  }
  return { weights: w, iterations: 1, logLikelihood: loglik(components, counts, w) };
};

/** Least squares on the shares (normal equations, clamped at 0, renormalised): consistent, but not maximum likelihood. */
const leastSquares: Mix = (components, counts) => {
  checkArgs(components, counts);
  const m = components.length;
  const N = counts.reduce((a, b) => a + b, 0);
  const shares = counts.map((k) => k / N);
  const A = components.map((r) => components.map((r2) => r.reduce((x, v, i) => x + v * (r2[i] ?? 0), 0)));
  const b = components.map((r) => r.reduce((x, v, i) => x + v * (shares[i] ?? 0), 0));
  const at = (r: number, c: number) => (A[r] as number[])[c] as number;
  for (let c = 0; c < m; c += 1) {
    for (let r = c + 1; r < m; r += 1) {
      const f = at(r, c) / at(c, c);
      for (let k = c; k < m; k += 1) (A[r] as number[])[k] = at(r, k) - f * at(c, k);
      b[r] = (b[r] as number) - f * (b[c] as number);
    }
  }
  const w = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r -= 1) {
    let v = b[r] as number;
    for (let k = r + 1; k < m; k += 1) v -= at(r, k) * (w[k] as number);
    w[r] = v / at(r, r);
  }
  const clamped = w.map((x) => Math.max(0, x));
  const total = clamped.reduce((a, b2) => a + b2, 0);
  const weights = clamped.map((x) => x / total);
  return { weights, iterations: 1, logLikelihood: loglik(components, counts, weights) };
};

async function failing(mix: Mix, seed: number, prefix: string): Promise<{ failed: number; of: number }> {
  const items = mixtureItems.filter((item) => item.id.startsWith(prefix));
  let failed = 0;
  for (const item of items) {
    const outcome = await runItem(item, seed, ROOT, { mixtureWeights: mix } as unknown as StatsImpl);
    if (!outcome.pass) failed += 1;
  }
  return { failed, of: items.length };
}

describe('the weights-mixture items tell the maximum-likelihood mix from a consistent estimator', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: expectation-maximisation passes every recover, em and refuse item`, async () => {
      for (const prefix of ['weights.recover.', 'weights.em.', 'weights.refuse.']) {
        expect(await failing(em, seed, prefix)).toMatchObject({ failed: 0 });
      }
    });

    it(`seed ${seed}: least squares passes the exact-mix items and fails nearly every em item`, async () => {
      expect(await failing(leastSquares, seed, 'weights.recover.')).toMatchObject({ failed: 0 });
      const emItems = await failing(leastSquares, seed, 'weights.em.');
      expect(emItems.failed).toBeGreaterThanOrEqual(Math.floor(emItems.of * 0.8));
    });
  }
});

describe('the mixture items check the shape of the result (a review finding: an extra weight passed every item)', () => {
  const wrap =
    (shape: (weights: number[]) => number[]): Mix =>
    (components, counts) => {
      const r = em(components, counts);
      return { ...r, weights: shape(r.weights) };
    };
  const cheats: Record<string, Mix> = {
    'an extra weight 0.25 appended': wrap((w) => [...w, 0.25]),
    'one weight too few': wrap((w) => w.slice(0, -1)),
    'weights summing to 0.9': wrap((w) => w.map((x) => x * 0.9)),
    'a weight above 1': wrap((w) => [1.5, ...w.slice(1).map(() => -0.5 / Math.max(1, w.length - 1))]),
  };
  for (const [name, mix] of Object.entries(cheats)) {
    it(`${name}: loses every recover and em item`, async () => {
      for (const seed of SEEDS) {
        for (const prefix of ['weights.recover.', 'weights.em.']) {
          const r = await failing(mix, seed, prefix);
          expect(r.failed).toBe(r.of);
        }
      }
    });
  }
  it('the correct expectation-maximisation still passes both', async () => {
    for (const seed of SEEDS) {
      expect((await failing(em, seed, 'weights.recover.')).failed).toBe(0);
      expect((await failing(em, seed, 'weights.em.')).failed).toBe(0);
    }
  });
});

describe('the agreement closure items kill the planted agreement bugs of the audit', () => {
  // The repository's own agreement code is the good product; each mutant plants one bug of the audit's round 1.
  const good = stats as unknown as Record<string, (...args: unknown[]) => Record<string, unknown>>;
  const kappa = (...args: unknown[]) => good.cohenKappa?.(...args) as { kappa: number };
  const alpha = (...args: unknown[]) =>
    good.krippendorffAlpha?.(...args) as { alpha: number; expected: number };
  const allEqual = (a: unknown[], b: unknown[]) => new Set([...a, ...b]).size === 1;
  const stringOrder = (a: unknown[], b: unknown[]) =>
    [...new Set([...a, ...b])].sort((x, y) => String(x).localeCompare(String(y)));
  const mutants: Record<string, { impl: Record<string, unknown>; killedBy: string }> = {
    B5: {
      killedBy: 'weights.kappa.constant.',
      impl: {
        cohenKappa: (a: unknown[], b: unknown[], o: { weights?: string } = {}) =>
          o.weights && o.weights !== 'none' && allEqual(a, b) ? { kappa: 0 } : kappa(a, b, o),
      },
    },
    B7: {
      killedBy: 'weights.kappa.default-order.numbers.',
      impl: {
        cohenKappa: (a: unknown[], b: unknown[], o: { weights?: string; categories?: unknown[] } = {}) =>
          !o.categories && o.weights && o.weights !== 'none'
            ? kappa(a, b, { ...o, categories: stringOrder(a, b) })
            : kappa(a, b, o),
      },
    },
    B10: {
      killedBy: 'weights.alpha.undefined-holes.',
      impl: {
        krippendorffAlpha: (m: unknown[][], o: unknown) =>
          alpha(
            m.map((row) => row.map((v) => (v === undefined ? 0 : v))),
            o,
          ),
      },
    },
    B12: {
      killedBy: 'weights.alpha.ratio.',
      impl: {
        krippendorffAlpha: (m: unknown, o: { level?: string } = {}) =>
          alpha(m, o.level === 'ratio' ? { level: 'interval' } : o),
      },
    },
    B13: {
      killedBy: 'weights.alpha.ordinal.',
      impl: {
        krippendorffAlpha: (m: unknown, o: { level?: string } = {}) =>
          alpha(m, o.level === 'ordinal' ? { level: 'interval' } : o),
      },
    },
    B15: {
      killedBy: 'weights.alpha.constant',
      impl: {
        krippendorffAlpha: (m: unknown, o: unknown) => {
          const r = alpha(m, o);
          return r.expected === 0 ? { ...r, alpha: 0 } : r;
        },
      },
    },
    K2b: {
      killedBy: 'weights.kappa.constant-identical.',
      impl: {
        cohenKappa: (a: unknown[], b: unknown[], o: { weights?: string } = {}) =>
          allEqual(a, b) && (!o.weights || o.weights === 'none') ? { kappa: 0 } : kappa(a, b, o),
      },
    },
    B16: {
      killedBy: 'weights.alpha.ragged.',
      impl: {
        krippendorffAlpha: (m: unknown[][], o: unknown) =>
          alpha(
            m.map((row) => row.slice(0, (m[0] as unknown[]).length)),
            o,
          ),
      },
    },
  };
  const closure = statsBank(ROOT).filter(
    (item) => item.id.startsWith('weights.kappa.') || item.id.startsWith('weights.alpha.'),
  );

  async function failingIds(impl: Record<string, unknown>, seed: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const item of closure) {
      const outcome = await runItem(item, seed, ROOT, { ...stats, ...impl } as unknown as StatsImpl);
      if (!outcome.pass) out.add(item.id);
    }
    return out;
  }

  it('the repository code passes every kappa and alpha item', async () => {
    for (const seed of SEEDS) expect([...(await failingIds({}, seed))]).toEqual([]);
  });

  for (const [name, mutant] of Object.entries(mutants)) {
    it(`${name} loses an item of ${mutant.killedBy}`, async () => {
      for (const seed of SEEDS) {
        const lost = [...(await failingIds(mutant.impl, seed))];
        expect(lost.some((id) => id.startsWith(mutant.killedBy))).toBe(true);
      }
    });
  }
});

describe('the coverage closure items kill the planted coverage bugs of the audit', () => {
  type Group = { axes: number[]; strength: number };
  type Result = {
    groups: Array<{ covered: number; required: number; coverage: number }>;
    covered: number;
    required: number;
    coverage: number;
  };
  const subsets = (items: number[], size: number): number[][] =>
    size === 0
      ? [[]]
      : items.length < size
        ? []
        : [
            ...subsets(items.slice(1), size - 1).map((x) => [items[0] as number, ...x]),
            ...subsets(items.slice(1), size),
          ];

  /** A small correct reference product (the repository has none): brute force, with the argument checks of the contract. */
  function reference(rows: number[][], groups: Group[], levels: number[], axisBound = levels.length): Result {
    if (groups.length === 0) throw new RangeError('mixedStrengthCoverage: groups is empty');
    if (levels.some((l) => !Number.isInteger(l) || l < 1))
      throw new RangeError('mixedStrengthCoverage: levels must be positive integers');
    for (const row of rows) {
      if (row.length !== levels.length)
        throw new RangeError('mixedStrengthCoverage: a row has another length than levels');
      row.forEach((v, a) => {
        if (!Number.isInteger(v) || v < 0 || v >= (levels[a] as number))
          throw new RangeError('mixedStrengthCoverage: a row value is outside its level');
      });
    }
    const per = groups.map((g) => {
      if (
        g.axes.some((a) => !Number.isInteger(a) || a < 0 || a >= axisBound) ||
        new Set(g.axes).size !== g.axes.length
      )
        throw new RangeError(
          'mixedStrengthCoverage: groups name an axis outside 0 to levels.length - 1, or repeat one',
        );
      if (g.strength < 1 || g.strength > g.axes.length)
        throw new RangeError('mixedStrengthCoverage: groups strength is out of range');
      let required = 0;
      let covered = 0;
      for (const axes of subsets(
        [...g.axes].sort((x, y) => x - y),
        g.strength,
      )) {
        required += axes.reduce((x, a) => x * (levels[a] as number), 1);
        covered += new Set(rows.map((r) => axes.map((a) => r[a]).join(','))).size;
      }
      return { covered, required, coverage: covered / required };
    });
    const covered = per.reduce((x, g) => x + g.covered, 0);
    const required = per.reduce((x, g) => x + g.required, 0);
    return { groups: per, covered, required, coverage: covered / required };
  }
  const full = (rows: number[][], groups: Group[], levels: number[]): Result => {
    const r = reference(rows, groups, levels);
    return {
      groups: r.groups.map((g) => ({ covered: g.required, required: g.required, coverage: 1 })),
      covered: r.required,
      required: r.required,
      coverage: 1,
    };
  };
  const impls: Record<string, { fn: unknown; killedBy: string }> = {
    C5: {
      fn: (rows: number[][], g: Group[], l: number[]) => reference(rows, g, l, l.length + 1),
      killedBy: 'weights.mixed-strength.refuse.axis-equal-levels',
    },
    'full-coverage stub': { fn: full, killedBy: 'weights.mixed-strength.' },
  };
  const items = statsBank(ROOT).filter((item) => item.id.startsWith('weights.mixed-strength.'));
  const failing = async (fn: unknown, seed: number) => {
    const out = new Set<string>();
    for (const item of items) {
      const outcome = await runItem(item, seed, ROOT, {
        ...stats,
        mixedStrengthCoverage: fn,
      } as unknown as StatsImpl);
      if (!outcome.pass) out.add(item.id);
    }
    return out;
  };

  it('a correct reference product passes every coverage item', async () => {
    for (const seed of SEEDS) expect([...(await failing(reference, seed))]).toEqual([]);
  });

  it('C5 (an axis equal to levels.length is accepted) loses the axis-equal-levels item', async () => {
    for (const seed of SEEDS)
      expect((await failing(impls.C5?.fn, seed)).has('weights.mixed-strength.refuse.axis-equal-levels')).toBe(
        true,
      );
  });

  it('a stub that always returns full coverage loses every dense item and every sparse item', async () => {
    for (const seed of SEEDS) {
      const lost = await failing(full, seed);
      for (const item of items.filter((i) => /\.(dense|sparse)$/.test(i.id)))
        expect(lost.has(item.id)).toBe(true);
    }
  });
});
