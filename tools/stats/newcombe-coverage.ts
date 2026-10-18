/** Run the actual Newcombe bank items, observing their draws without changing the bank or its bar. */
import { execFileSync } from 'node:child_process';
import * as stats from '../../packages/stats/src/index';
import { itemRng } from '../../packages/validators/src/ladders/stats/bank/item';
import { coverageBar, rateItems } from '../../packages/validators/src/ladders/stats/bank/rates';

const seeds = [...Array.from({ length: 256 }, (_, i) => i + 1), 362983924];
const draws = 2000;
const results = [];
for (const n of [30, 100]) {
  const id = `simulation.newcombe.n${n}`;
  const item = rateItems().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing bank item ${id}`);
  const runs = [];
  for (const seed of seeds) {
    const source = itemRng(seed, id);
    let calls = 0;
    let pb = 0;
    let pc = 0;
    let held = 0;
    let intervals = 0;
    const rng = () => {
      const u = source();
      // Each actual bank draw consumes two marginal rates, a joint rate and n categorical draws.
      const offset = calls++ % (n + 3);
      if (offset === 0) pb = 0.2 + 0.75 * u;
      if (offset === 1) pc = Math.min(0.99, Math.max(0.01, pb + 0.3 * (u - 0.5)));
      return u;
    };
    const outcome = await item.check({
      root: process.cwd(),
      seed,
      rng,
      s: {
        ...stats,
        pairedRateDifference: (table, alpha) => {
          const ci = stats.pairedRateDifference(table, alpha);
          if (ci.lower <= pb - pc && pb - pc <= ci.upper) held += 1;
          intervals += 1;
          return ci;
        },
      },
    });
    if (intervals !== draws || calls !== draws * (n + 3)) throw new Error('Bank draw protocol changed');
    if (outcome.pass !== held / draws >= coverageBar(draws)) throw new Error('Observer disagrees with bank');
    runs.push({ seed, held, coverage: held / draws, pass: outcome.pass });
  }
  // The reported distribution excludes the separately selected historical failure seed.
  const sweep = runs.slice(0, -1);
  const sorted = sweep.map((run) => run.coverage).sort((a, b) => a - b);
  const totalHeld = sweep.reduce((sum, run) => sum + run.held, 0);
  const mean = totalHeld / (sweep.length * draws);
  const sd = Math.sqrt(sweep.reduce((sum, run) => sum + (run.coverage - mean) ** 2, 0) / (sweep.length - 1));
  const se = Math.sqrt((mean * (1 - mean)) / (sweep.length * draws));
  const q = (p: number) => stats.quantileSorted(sorted, p);
  results.push({
    id,
    draws,
    seedCount: sweep.length,
    bar: coverageBar(draws),
    totalHeld,
    totalDraws: sweep.length * draws,
    mean,
    sd,
    pooled95: stats.wilson(totalHeld, sweep.length * draws),
    pooledSE: se,
    zBelowNominal: (0.95 - mean) / se,
    min: sorted[0],
    p05: q(0.05),
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    p95: q(0.95),
    max: sorted[sorted.length - 1],
    failures: sweep.filter((run) => !run.pass).map((run) => run.seed),
    historical: runs[runs.length - 1],
    runs,
  });
}
console.log(
  JSON.stringify(
    {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      measuredAt: new Date().toISOString(),
      node: process.version,
      results,
    },
    null,
    2,
  ),
);
