import type { Measure } from '../../../ladder';
import { clusteredLevel } from '../clustered';
import { designsPath, readDesigns, type StatsDesigns } from '../designs';
import { generator } from '../draw';
import { powerLevel } from '../power';
import type { StatsImpl } from '../reference';
import {
  SHARE_LEVELS,
  SHARES_LEVEL_MISSES,
  SHARES_NESTED_MISSES,
  SHARES_RECOVERY,
  sharesLevel,
} from '../shares';
import { unseenLevel } from '../unseen';
import { WILSON_COVERAGE, WILSON_DRAWS, WILSON_RATES } from '../wilson';
import { type BankItem, fail, ok } from './item';

/**
 * Level `simulation`: the levels 2 to 6 of ladder version 1, one item per design, so each failing design is named
 * on its own. The truths are planted and the coverage, recovery, error and power are counted over draws.
 */

/**
 * The coverage bar of one clustered design alone (1000 draws, a correct interval covers about 0.945).
 *
 * Measured 2026-10-13 on main a0a3e5d7, seeds 10000 to 10051 (52 seeds): a correct implementation covers
 * 0.9448 (c80x8-rho0.2), 0.9445 (c120x6-rho0.3) and 0.947 (c160x4-rho0.5) of its draws. The coverage of one seed
 * is binomial over its 1000 draws (spread over seeds 0.0056 to 0.0079, binomial 0.0071 to 0.0072), so a correct
 * implementation falls under 0.92 on 4.7e-4, 5.4e-4 and 1.4e-4 of the seeds. Hidden seed 696095767 gave 0.915
 * on c120x6-rho0.3, an 8.5e-5 event. The wrong implementations the family plants cover 0.48 to 0.81 on that seed
 * (no clustering, a naive Wilson interval, a resample unit that is not the conversation). A bar of 0.91 would
 * lower the false failures to about 4e-6 but catch an interval at 0.90 on 84 percent of seeds instead of 98.
 */
export const SINGLE_DESIGN_COVERAGE = 0.92;

const designsCache = new Map<string, StatsDesigns>();
function designs(root: string): StatsDesigns {
  let d = designsCache.get(root);
  if (!d) {
    d = readDesigns(designsPath(root));
    designsCache.set(root, d);
  }
  return d;
}

/** One shared computation per seed and key (the shares and unseen runs serve several items). */
const memo = new Map<string, Measure>();
function once(key: string, compute: () => Measure): Measure {
  let m = memo.get(key);
  if (!m) {
    m = compute();
    memo.set(key, m);
  }
  return m;
}

const item = (
  id: string,
  tier: 3 | 4,
  component: string,
  check: BankItem['check'],
  budgetMs = 300_000,
): BankItem => ({
  id,
  family: 'coverage-simulation',
  tier,
  level: 'simulation',
  component,
  budgetMs,
  check,
});

function wilsonCoverage(seed: number, s: StatsImpl, n: number) {
  const rng = generator(seed, n);
  let contained = 0;
  let firstMiss = '';
  for (let draw = 0; draw < WILSON_DRAWS; draw += 1) {
    const truth = WILSON_RATES.low + (WILSON_RATES.high - WILSON_RATES.low) * rng();
    let k = 0;
    for (let trial = 0; trial < n; trial += 1) if (rng() < truth) k += 1;
    const ci = s.wilson(k, n);
    if (ci.lower <= truth && truth <= ci.upper) contained += 1;
    else if (!firstMiss) firstMiss = `draw ${draw}: truth ${truth}, interval [${ci.lower}, ${ci.upper}]`;
  }
  return { coverage: contained / WILSON_DRAWS, firstMiss };
}

export function simulationItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const n of [20, 50, 200]) {
    out.push(
      item(`simulation.wilson-coverage.n${n}`, 3, 'packages/stats/src/intervals.ts', ({ seed, s }) => {
        const r = wilsonCoverage(seed, s, n);
        return r.coverage >= WILSON_COVERAGE
          ? ok()
          : fail(
              `wilson at n ${n}: ${r.coverage} of ${WILSON_DRAWS} intervals hold a true rate drawn uniform on [0.1, 0.9] (bar ${WILSON_COVERAGE}); first miss ${r.firstMiss}.`,
            );
      }),
    );
  }
  for (const id of ['c80x8-rho0.2', 'c120x6-rho0.3', 'c160x4-rho0.5']) {
    out.push(
      item(`simulation.clustered.${id}`, 4, 'packages/stats/src/intervals.ts', ({ seed, s, root }) => {
        const plan = designs(root).clustered;
        const design = plan.designs.find((d) => d.id === id);
        if (!design) return fail(`the designs file has no clustered design ${id}`);
        const m = clusteredLevel(seed, s, { ...plan, designs: [design] });
        // One design alone has 1000 draws: its bar is 0.92 (version 1 pooled three designs against 0.93).
        return m.value >= SINGLE_DESIGN_COVERAGE
          ? ok()
          : fail(
              `clustered bootstrap on design ${id}: value ${m.value} (bar ${SINGLE_DESIGN_COVERAGE}; 0 means the naive interval also covered). ${m.items.map((i) => i.detail).join(' | ')}`,
            );
      }),
    );
  }
  const shares = (seed: number, root: string) =>
    once(`shares:${seed}:${root}`, () => sharesLevel(seed, designs(root).shares));
  out.push(
    item('simulation.shares.pooled', 4, 'packages/generate/src/pilot/analyse.ts', ({ seed, root }) => {
      const m = shares(seed, root);
      return m.value >= SHARES_RECOVERY
        ? ok()
        : fail(
            `analysePilot recovered ${m.value} of the planted shares over ${designs(root).shares.datasets} datasets (bar ${SHARES_RECOVERY}): ${m.items
              .map((i) => i.detail)
              .slice(0, 3)
              .join(' | ')}`,
          );
    }),
  );
  for (const level of SHARE_LEVELS) {
    out.push(
      item(`simulation.shares.${level}`, 4, 'packages/generate/src/pilot/analyse.ts', ({ seed, root }) => {
        const misses = shares(seed, root).items.filter((i) => i.id.endsWith(`-${level}`));
        return misses.length <= SHARES_LEVEL_MISSES[level]
          ? ok()
          : fail(
              `the planted ${level} share fell outside the analysePilot bootstrap interval on ${misses.length} of ${designs(root).shares.datasets} datasets (at most ${SHARES_LEVEL_MISSES[level]}): ${misses
                .map((i) => i.detail)
                .slice(0, 2)
                .join(' | ')}`,
            );
      }),
    );
  }
  // Wordings carry most of the spread here, so an analysis that does not take the lower levels' variance out of
  // a level's mean square puts it on the conversation level, above the planted share.
  out.push(
    item('simulation.shares.nested', 4, 'packages/generate/src/pilot/analyse.ts', ({ seed, root }) => {
      const design = designs(root).sharesNested;
      const misses = sharesLevel(seed, design, undefined, 1).items.filter((i) =>
        i.id.endsWith('-conversation'),
      );
      return misses.length <= SHARES_NESTED_MISSES
        ? ok()
        : fail(
            `on the nested design (wording spread ${design.logitSd.wording} on the logit scale, conversation ${design.logitSd.conversation}) the planted conversation share fell outside the analysePilot bootstrap interval on ${misses.length} of ${design.datasets} datasets (at most ${SHARES_NESTED_MISSES}); a variance-components estimator that leaves the wording variance in the conversation mean square does this: ${misses
              .map((i) => i.detail)
              .slice(0, 2)
              .join(' | ')}`,
          );
    }),
  );
  const unseen = (seed: number, s: StatsImpl, root: string) =>
    once(`unseen:${seed}:${root}`, () => unseenLevel(seed, s, designs(root).unseen));
  for (const pop of ['s60-spread5', 's120-spread10']) {
    for (const key of ['chao-form', 'good-turing', 'chao-stats']) {
      out.push(
        item(
          `simulation.unseen.${key}.${pop}`,
          4,
          key === 'chao-stats' ? 'packages/stats/src/coverage.ts' : 'packages/space/src/complete.ts',
          ({ seed, s, root }) => {
            const bad = unseen(seed, s, root).items.filter(
              (i) => i.id.startsWith(`unseen-${key}-${pop}`) || i.id.startsWith(`refused-${pop}`),
            );
            return bad.length === 0 ? ok() : fail(bad.map((i) => i.detail).join(' | '));
          },
        ),
      );
    }
    out.push(
      item(`simulation.unseen.warning.${pop}`, 3, 'packages/space/src/complete.ts', ({ seed, s, root }) => {
        const bad = unseen(seed, s, root).items.filter((i) => i.id.startsWith(`warning-${pop}`));
        return bad.length === 0 ? ok() : fail(bad.map((i) => i.detail).join(' | '));
      }),
    );
  }
  for (const id of ['n60-r1-p0.85', 'n80-r3-p0.8', 'n40-r5-p0.7', 'n150-r2-p0.9', 'n100-r4-p0.6']) {
    out.push(
      item(`simulation.power.${id}`, 4, 'packages/stats/src/power.ts', ({ seed, s, root }) => {
        const plan = designs(root).power;
        const design = plan.designs.find((d) => d.id === id);
        if (!design) return fail(`the designs file has no power design ${id}`);
        const m = powerLevel(seed, s, { ...plan, designs: [design] });
        return m.value <= 0.05 ? ok() : fail(m.items.map((i) => i.detail).join(' | ') || `gap ${m.value}`);
      }),
    );
  }
  return out;
}
