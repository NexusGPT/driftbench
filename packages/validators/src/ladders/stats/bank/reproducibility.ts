import { analysePilot } from '@agent-nexus/driftbench-generate';
import type { Observation } from '@agent-nexus/driftbench-stats';
import { generator, normal } from '../draw';
import type { StatsImpl } from '../reference';
import { plantShares } from '../shares';
import { attempt, type BankItem, fail, near, ok, show } from './item';

/**
 * Level `reproducibility`: the same seed gives the same bits, another seed gives another draw, and a statistic
 * that does not depend on the order of its input does not change when the input is shuffled (to 1e-12).
 */

const item = (id: string, component: string, check: BankItem['check']): BankItem => ({
  id,
  family: 'reproducibility',
  tier: 1,
  level: 'reproducibility',
  component,
  check,
});

function shuffle<T>(rng: () => number, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The mulberry32 outputs pinned at ladder version 2: a change of generator changes every seeded result. */
const MULBERRY = { seed: 12345 };

export function reproducibilityItems(): BankItem[] {
  const out: BankItem[] = [];
  const intervals = 'packages/stats/src/intervals.ts';
  for (const [label, clustered, method] of [
    ['plain', false, 'percentile'],
    ['clustered', true, 'percentile'],
    ['basic', true, 'basic'],
  ] as const) {
    out.push(
      item(`reproducibility.bootstrap-same-seed.${label}`, intervals, ({ s, rng }) => {
        const values = Array.from({ length: 60 }, () => Math.round(rng() * 1000) / 1000);
        const clusters = values.map((_, i) => Math.floor(i / 4));
        const seed = Math.floor(rng() * 1e6);
        const run = () =>
          s.bootstrapCI(values, { ...(clustered ? { clusters } : {}), seed, method, iterations: 400 });
        const a = attempt(run);
        const b = attempt(run);
        if (a.error) return fail(`bootstrapCI threw ${a.error.message}`);
        return same(a.value, b.value)
          ? ok()
          : fail(
              `bootstrapCI(values, { seed: ${seed}, ${label} }) gave ${show(a.value)} then ${show(b.value)}; the same seed must give the same bits.`,
            );
      }),
      item(`reproducibility.bootstrap-other-seed.${label}`, intervals, ({ s, rng }) => {
        const values = Array.from({ length: 60 }, () => Math.round(rng() * 1000) / 1000);
        const clusters = values.map((_, i) => Math.floor(i / 4));
        const run = (seed: number) =>
          s.bootstrapCI(values, { ...(clustered ? { clusters } : {}), seed, method, iterations: 400 });
        const a = attempt(() => run(1));
        const b = attempt(() => run(2));
        if (a.error) return fail(`bootstrapCI threw ${a.error.message}`);
        return !same(a.value, b.value)
          ? ok()
          : fail(
              `bootstrapCI(values, ${label}) gave the same interval for seeds 1 and 2: the seed does not reach the resampling.`,
            );
      }),
    );
  }
  out.push(
    item('reproducibility.mulberry32-pinned', 'packages/stats/src/basics.ts', ({ s }) => {
      const r = s.mulberry32(MULBERRY.seed);
      const got = Array.from({ length: 5 }, () => r());
      const want = [
        0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061,
      ];
      return same(got, want)
        ? ok()
        : fail(
            `mulberry32(${MULBERRY.seed}) first five values ${show(got)}; ladder version 2 pinned ${show(want)}. A changed generator changes every seeded interval and report.`,
          );
    }),
    item('reproducibility.analyse-pilot-same-seed', 'packages/generate/src/pilot/analyse.ts', ({ seed }) => {
      const { observations } = plantShares(generator(seed, 99), {
        datasets: 1,
        cells: 4,
        conversations: 3,
        wordings: 2,
        repeats: 2,
        logitMean: 0.5,
        logitSd: { cell: 0.6, conversation: 0.8, wording: 0.6 },
      });
      const a = analysePilot(observations, { seed: 7, iterations: 50 });
      const b = analysePilot(observations, { seed: 7, iterations: 50 });
      return same(a, b)
        ? ok()
        : fail('analysePilot on the same observations with seed 7 gave two different analyses.');
    }),
  );
  // Order invariance: shuffle the input, the answer stays (to 1e-12).
  type Inv = [string, string, (s: StatsImpl, rng: () => number) => [unknown, unknown]];
  const values = (rng: () => number, n = 40) =>
    Array.from({ length: n }, () => Math.round(normal(rng) * 1000) / 1000);
  const invariants: Inv[] = [
    [
      'mean',
      'packages/stats/src/basics.ts',
      (s, rng) => {
        const v = values(rng);
        return [s.mean(v), s.mean(shuffle(rng, v))];
      },
    ],
    [
      'quantile',
      'packages/stats/src/basics.ts',
      (s, rng) => {
        const v = values(rng);
        return [s.quantile(v, 0.37), s.quantile(shuffle(rng, v), 0.37)];
      },
    ],
    [
      'sample-variance',
      'packages/stats/src/basics.ts',
      (s, rng) => {
        const v = values(rng);
        return [s.sampleVariance(v), s.sampleVariance(shuffle(rng, v))];
      },
    ],
    [
      'wilcoxon-pairs',
      'packages/stats/src/paired.ts',
      (s, rng) => {
        const x = values(rng, 30);
        const y = values(rng, 30);
        const order = shuffle(
          rng,
          x.map((_, i) => i),
        );
        return [
          s.wilcoxonSignedRank(x, y).pValue,
          s.wilcoxonSignedRank(
            order.map((i) => x[i] as number),
            order.map((i) => y[i] as number),
          ).pValue,
        ];
      },
    ],
    [
      'ks',
      'packages/stats/src/drift.ts',
      (s, rng) => {
        const a = values(rng, 25);
        const b = values(rng, 30);
        return [s.ksTest(a, b).pValue, s.ksTest(shuffle(rng, a), shuffle(rng, b)).pValue];
      },
    ],
    [
      'kappa-items',
      'packages/stats/src/agreement.ts',
      (s, rng) => {
        const a = Array.from({ length: 30 }, () => (rng() < 0.5 ? 'x' : rng() < 0.5 ? 'y' : 'z'));
        const b = a.map((v) => (rng() < 0.7 ? v : 'y'));
        const order = shuffle(
          rng,
          a.map((_, i) => i),
        );
        return [
          s.cohenKappa(a, b).kappa,
          s.cohenKappa(
            order.map((i) => a[i] as string),
            order.map((i) => b[i] as string),
          ).kappa,
        ];
      },
    ],
    [
      'alpha-units',
      'packages/stats/src/agreement.ts',
      (s, rng) => {
        const a = Array.from({ length: 30 }, () => 1 + Math.floor(rng() * 4));
        const b = a.map((v) => (rng() < 0.7 ? v : 2));
        const order = shuffle(
          rng,
          a.map((_, i) => i),
        );
        return [
          s.krippendorffAlpha([a, b]).alpha,
          s.krippendorffAlpha([order.map((i) => a[i] as number), order.map((i) => b[i] as number)]).alpha,
        ];
      },
    ],
    [
      'chao-classes',
      'packages/stats/src/coverage.ts',
      (s, rng) => {
        const c = Array.from({ length: 30 }, () => Math.floor(rng() * 5));
        return [s.chaoCoverage(c), s.chaoCoverage(shuffle(rng, c))];
      },
    ],
    [
      'hill-classes',
      'packages/stats/src/coverage.ts',
      (s, rng) => {
        const c = Array.from({ length: 30 }, () => 1 + Math.floor(rng() * 9));
        return [s.hillNumbers(c), s.hillNumbers(shuffle(rng, c))];
      },
    ],
    [
      'variance-rows',
      'packages/stats/src/variance.ts',
      (s, rng) => {
        const obs: Observation[] = Array.from({ length: 48 }, (_, i) => ({
          value: normal(rng),
          path: [String(i % 4), String(i % 3), String(i % 2)],
        }));
        return [
          s.varianceComponents(obs).components.map((c) => c.estimate),
          s.varianceComponents(shuffle(rng, obs)).components.map((c) => c.estimate),
        ];
      },
    ],
    [
      'bh-equivariance',
      'packages/stats/src/multiple.ts',
      (s, rng) => {
        const p = Array.from({ length: 12 }, () => Math.round(rng() ** 2 * 1e4) / 1e4);
        const order = shuffle(
          rng,
          p.map((_, i) => i),
        );
        const a = s.benjaminiHochberg(p).adjusted;
        const b = s.benjaminiHochberg(order.map((i) => p[i] as number)).adjusted;
        return [order.map((i) => a[i]), b];
      },
    ],
    [
      'neyman-equivariance',
      'packages/stats/src/variance.ts',
      (s, rng) => {
        const sizes = Array.from({ length: 5 }, () => 10 + Math.floor(rng() * 50));
        const sds = Array.from({ length: 5 }, () => Math.round(rng() * 50) / 100);
        const order = shuffle(
          rng,
          sizes.map((_, i) => i),
        );
        const a = s.neymanAllocation({ sizes, sds, total: 30 }).exact;
        const b = s.neymanAllocation({
          sizes: order.map((i) => sizes[i] as number),
          sds: order.map((i) => sds[i] as number),
          total: 30,
        }).exact;
        return [order.map((i) => a[i]), b];
      },
    ],
    [
      'bootstrap-cluster-names',
      'packages/stats/src/intervals.ts',
      (s, rng) => {
        const v = values(rng, 24);
        const keys = v.map((_, i) => Math.floor(i / 3));
        return [
          s.bootstrapCI(v, { clusters: keys, seed: 3 }),
          s.bootstrapCI(v, { clusters: keys.map((k) => `conversation-${k}`), seed: 3 }),
        ];
      },
    ],
    [
      'unreliability',
      'packages/stats/src/reliability.ts',
      (s, rng) => {
        const v = values(rng);
        return [s.unreliability(v), s.unreliability(shuffle(rng, v))];
      },
    ],
  ];
  const close = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return near(a, b, 1e-12 * Math.max(1, Math.abs(a)));
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((x, i) => close(x, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object')
      return Object.keys(a).every((k) =>
        close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      );
    return a === b;
  };
  for (const [key, component, run] of invariants) {
    out.push(
      item(`reproducibility.order.${key}`, component, ({ s, rng }) => {
        const got = attempt(() => run(s, rng));
        if (got.error) return fail(`the ${key} order check threw ${got.error.name}: ${got.error.message}`);
        const [a, b] = got.value as [unknown, unknown];
        return close(a, b)
          ? ok()
          : fail(
              `${key}: shuffling the input changed the answer from ${show(a)} to ${show(b)}; it does not depend on the order, so it must agree to 1e-12.`,
            );
      }),
    );
  }
  return out;
}
