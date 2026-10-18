import { describe, expect, it } from 'vitest';
import {
  abundances,
  betaQuantile,
  chaoCoverage,
  designEffect,
  goodTuring,
  hillNumber,
  hillNumbers,
  icc,
  mulberry32,
  neymanAllocation,
  type Observation,
  repeatsForFloor,
  varianceComponents,
} from '../src/index';
import { fixtures, near } from './support';

describe('varianceComponents', () => {
  it('matches the numpy nested ANOVA (balanced) and Henderson method I (unbalanced)', () => {
    for (const c of fixtures.varianceComponents) {
      const r = varianceComponents(c.observations, c.levels ? { levels: c.levels } : {});
      expect(r.balanced, `${c.name} balanced`).toBe(c.balanced);
      r.components.forEach((comp, i) => {
        expect(comp.df, `${c.name} df ${comp.level}`).toBe(c.df[i]);
        near(comp.sumSquares, c.ss[i] as number, `${c.name} SS ${comp.level}`);
        near(comp.meanSquare, c.ms[i] as number, `${c.name} MS ${comp.level}`);
        near(comp.estimate, c.estimates[i] as number, `${c.name} estimate ${comp.level}`);
      });
    }
  });
  it('recovers known variances from a large seeded simulation (cell 0.09, conversation 0.04, wording 0.01, repeat 0.0625)', () => {
    const rng = mulberry32(77);
    const normal = (sd: number): number => {
      const u = 1 - rng();
      const v = rng();
      return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const rows: Observation[] = [];
    for (let a = 0; a < 60; a += 1) {
      const ua = normal(0.3);
      for (let b = 0; b < 12; b += 1) {
        const ub = normal(0.2);
        for (let c = 0; c < 3; c += 1) {
          const uc = normal(0.1);
          for (let r = 0; r < 5; r += 1)
            rows.push({ value: ua + ub + uc + normal(0.25), path: [`c${a}`, `v${b}`, `w${c}`] });
        }
      }
    }
    const result = varianceComponents(rows);
    const est = Object.fromEntries(result.components.map((c) => [c.level, c.variance]));
    near(est.cell as number, 0.09, 'cell variance', 0.035);
    near(est.conversation as number, 0.04, 'conversation variance', 0.008);
    near(est.wording as number, 0.01, 'wording variance', 0.004);
    near(est.repeat as number, 0.0625, 'repeat variance', 0.004);
    const shares = result.components.reduce((s, c) => s + c.share, 0);
    near(shares, 1, 'shares sum to 1', 1e-12);
  });
  it('reads booleans as 0/1 and truncates a negative estimate at 0 while reporting it', () => {
    const rows: Observation[] = [];
    // Conversations identical in mean, repeats noisy: the conversation estimate goes negative.
    for (let b = 0; b < 4; b += 1) {
      for (let r = 0; r < 4; r += 1) rows.push({ value: (b + r) % 2 === 0, path: [`v${b}`] });
    }
    const result = varianceComponents(rows, { levels: ['conversation'] });
    const conv = result.components[0];
    expect(conv?.estimate).toBeLessThan(0);
    expect(conv?.variance).toBe(0);
    expect(result.mean).toBe(0.5);
  });
  it('refuses an observation whose path does not match the levels', () => {
    expect(() => varianceComponents([{ value: 1, path: ['a'] }])).toThrow(RangeError);
  });
});

describe('icc and the measured design effect', () => {
  it('is cumulative: two observations in one conversation share the cell and the conversation', () => {
    const c = fixtures.varianceComponents[0];
    const r = varianceComponents(c?.observations ?? []);
    const levels = icc(r);
    const v = r.components.map((x) => x.variance);
    const total = v.reduce((s, x) => s + x, 0);
    near(levels[0]?.icc as number, (v[0] as number) / total, 'icc cell');
    near(levels[1]?.icc as number, ((v[0] as number) + (v[1] as number)) / total, 'icc conversation');
    near(
      levels[2]?.icc as number,
      ((v[0] as number) + (v[1] as number) + (v[2] as number)) / total,
      'icc wording',
    );
    const rho = levels[1]?.icc as number;
    near(designEffect(15, rho), 1 + 14 * rho, 'design effect from the measured rho');
  });
});

describe('neymanAllocation', () => {
  it('allocates the whole numbers that minimise the stratified variance, matching the reference', () => {
    for (const c of fixtures.neyman) {
      const r = neymanAllocation(c);
      r.exact.forEach((x, i) => {
        near(x, c.exact[i] as number, `exact[${i}]`);
      });
      expect(r.allocated).toEqual(c.allocated);
      expect(r.allocated.reduce((s, x) => s + x, 0)).toBe(c.total);
    }
  });
});

describe('repeatsForFloor', () => {
  it('gives the smallest repeats whose run-to-run half-width is under the floor', () => {
    for (const c of fixtures.repeatsForFloor) {
      const r = repeatsForFloor(c.input);
      expect(r.repeats, JSON.stringify(c.input)).toBe(c.repeats);
      near(r.floor, c.floor, `floor ${JSON.stringify(c.input)}`);
      expect(r.floor).toBeLessThanOrEqual(c.input.floor + 1e-12);
    }
  });
  it('needs a variance or a flip rate', () => {
    expect(() => repeatsForFloor({ floor: 0.1 })).toThrow(RangeError);
  });
});

describe('goodTuring, chaoCoverage and hillNumbers', () => {
  it('match the reference formulas, the f2 = 0 fallback included', () => {
    for (const c of fixtures.coverage) {
      const gt = goodTuring(c.counts);
      expect([gt.n, gt.observed, gt.f1, gt.f2]).toEqual([c.n, c.observed, c.f1, c.f2]);
      near(gt.discoveryProbability, c.discoveryProbability, `${c.name} discovery`);
      near(gt.coverage, c.turingCoverage, `${c.name} Turing coverage`);
      const ch = chaoCoverage(c.counts);
      near(ch.coverage, c.coverage, `${c.name} Chao coverage`);
      near(ch.chao1, c.chao1, `${c.name} Chao1`);
      const h = hillNumbers(c.counts);
      expect(h.q0).toBe(c.q0);
      near(h.q1, c.q1, `${c.name} q1`);
      near(h.q2, c.q2, `${c.name} q2`);
      near(hillNumber(c.counts, 3), c.q3, `${c.name} q3`);
    }
  });
  it('orders the Hill numbers q0 >= q1 >= q2', () => {
    for (const c of fixtures.coverage) {
      const h = hillNumbers(c.counts);
      expect(h.q0).toBeGreaterThanOrEqual(h.q1 - 1e-12);
      expect(h.q1).toBeGreaterThanOrEqual(h.q2 - 1e-12);
    }
  });
  it('counts abundances from labels', () => {
    expect(abundances(['a', 'b', 'a', 'c', 'a']).sort()).toEqual([1, 1, 3]);
  });
});

describe('varianceComponents is stable under a common offset', () => {
  it('adding 1e9 to every value leaves the estimates unchanged', () => {
    let state = 12345;
    const draw = (): number => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    const obs = Array.from({ length: 120 }, (_, i) => ({
      value: draw() + (i % 4),
      path: [String(i % 4), String(i % 12), String(i % 2)],
    }));
    const a = varianceComponents(obs).components.map((c) => c.estimate);
    const b = varianceComponents(obs.map((o) => ({ ...o, value: o.value + 1e9 }))).components.map(
      (c) => c.estimate,
    );
    a.forEach((x, i) => {
      expect(Math.abs((b[i] as number) - x)).toBeLessThan(1e-5 * Math.max(1, Math.abs(x)));
    });
  });
});

describe('hillNumber near q = 1', () => {
  it('is continuous in q', () => {
    const c = [40, 12, 7, 3, 3, 2, 2, 1, 1, 1];
    const q1 = hillNumber(c, 1);
    for (const q of [1 + 1e-12, 1 - 1e-12, 1 + 1e-7]) {
      expect(Math.abs(hillNumber(c, q) - q1) / q1).toBeLessThan(1e-6);
    }
  });
  it('still gives the closed form at q = 2', () => {
    expect(hillNumber([1, 1], 2)).toBeCloseTo(2, 12);
    expect(hillNumber([3, 1], 2)).toBeCloseTo(1 / (0.75 ** 2 + 0.25 ** 2), 12);
  });
});

describe('betaQuantile in the lower tail of a U-shaped beta', () => {
  it('keeps its relative accuracy', () => {
    const got = betaQuantile(1e-6, 0.5, 0.5);
    expect(Math.abs(got - 2.46740110027031e-12) / 2.46740110027031e-12).toBeLessThan(1e-6);
  });
});

describe('neymanAllocation at scale', () => {
  const strataOf = (count: number) => {
    const sizes = Array.from({ length: count }, (_, i) => 1 + (i % 100));
    const sds = sizes.map((_, i) => ((i * 7919) % 1000) / 1000 + 0.001);
    return { sizes, sds };
  };

  it('allocates 1e6 units over 1e5 strata and sums to the total', () => {
    const r = neymanAllocation({ ...strataOf(100_000), total: 1_000_000 });
    expect(r.allocated.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  /**
   * Counts the element reads and writes of every array the allocation derives from its sizes. An array
   * method such as map builds its result through the species constructor of its source, so sizes that
   * name a counting constructor hand it on to the weights, the allocation and the heap.
   */
  function elementAccesses(strata: number): number {
    let accesses = 0;
    const isIndex = (key: string | symbol) => typeof key === 'string' && /^\d+$/.test(key);
    const handler: ProxyHandler<unknown[]> = {
      get(target, key, receiver) {
        if (isIndex(key)) accesses += 1;
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        if (isIndex(key)) accesses += 1;
        return Reflect.set(target, key, value, receiver);
      },
    };
    const species = { [Symbol.species]: Counted };
    const mark = <T>(list: T[]): T[] => Object.defineProperty(list, 'constructor', { value: species });
    function Counted(length: number): unknown[] {
      return new Proxy(mark(new Array(length)), handler);
    }
    const { sizes, sds } = strataOf(strata);
    const total = strata * 10;
    const r = neymanAllocation({ sizes: mark(sizes), sds, total });
    expect(r.allocated.reduce((a, b) => a + b, 0)).toBe(total);
    // The counter is live: each unit past the first of a stratum costs at least one counted write.
    expect(accesses).toBeGreaterThan(total);
    return accesses;
  }

  it('does work that grows near linearly with the problem, not with units times strata', () => {
    // Four times the strata and four times the units. One heap step per unit grows the count by a little
    // over four; a scan of every stratum per unit grows it by sixteen.
    const growth = elementAccesses(2000) / elementAccesses(500);
    expect(growth).toBeGreaterThan(3);
    expect(growth).toBeLessThan(8);
  });
});

describe('varianceComponents on constant and binary data', () => {
  const rowsOf = (values: boolean[]) =>
    values.map((value, i) => ({ value, path: [String(i % 2), String(i % 4), String(i % 8)] }));
  it('gives exactly 0 for every component when all values are equal', () => {
    for (const v of [true, false]) {
      const r = varianceComponents(rowsOf(Array.from({ length: 24 }, () => v)));
      for (const c of r.components) expect(c.estimate).toBe(0);
    }
  });
  it('gives exactly 0 for the repeat component when the repeats of each wording agree', () => {
    const grid = [
      [
        [true, true, true],
        [true, true, true],
        [true, true, true],
      ],
      [
        [false, false, false],
        [true, false, true],
        [true, true, true],
      ],
    ];
    const obs = grid.flatMap((cell, c) =>
      cell.flatMap((conv, v) =>
        conv.flatMap((pass, w) =>
          [0, 1, 2, 3, 4].map(() => ({ value: pass, path: [`cell-${c}`, `conv-${c}-${v}`, String(w)] })),
        ),
      ),
    );
    const r = varianceComponents(obs);
    for (const c of r.components.slice(-1)) {
      expect(c.estimate).toBe(0);
      expect(c.variance).toBe(0);
    }
  });
});
