/**
 * Reproduce tail-item calibration from the actual bank's samples and estimator calls.
 * pnpm exec tsx tools/stats/unseen-tails.ts [first seed=1] [last seed=20000]
 * Add --mutants to compare all 12 items on planted faults (suggested seeds 1..200).
 * The first sample and old bars reproduce origin/main a09da6e20; all four samples
 * and current bars reproduce the changed items. No estimator or RNG is substituted.
 */
import * as stats from '../../packages/stats/src/index';
import { analyticItems } from '../../packages/validators/src/ladders/stats/bank/analytic';
import { itemRng } from '../../packages/validators/src/ladders/stats/bank/item';

const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 20000);
const mutants = process.argv.includes('--mutants');
const selected = new Set([
  'analytic.unseen.chao1-large.s80-tail10',
  'analytic.unseen.hill-q1.s40-tail5',
  'analytic.unseen.hill-q2.s40-tail5',
]);
const items = analyticItems().filter((item) =>
  mutants ? /^analytic\.unseen\.(chao1-large|hill-q[12])\./.test(item.id) : selected.has(item.id),
);
const results = [];
for (const item of items) {
  const key = item.id.includes('chao1') ? 'chao1' : item.id.includes('q1') ? 'q1' : 'q2';
  const [, classesText, spreadText] = /\.s(\d+)-(?:tail(\d+)|even)$/.exec(item.id) ?? [];
  const classes = Number(classesText);
  const spread = Number(spreadText ?? 1);
  const weights = Array.from({ length: classes }, (_, i) => spread ** (-i / (classes - 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map((w) => w / total);
  const truth =
    key === 'chao1'
      ? classes
      : key === 'q1'
        ? Math.exp(-probs.reduce((a, p) => a + p * Math.log(p), 0))
        : 1 / probs.reduce((a, p) => a + p * p, 0);
  const oldBar = key === 'q2' ? 0.1 : 0.05;
  const newBar = { chao1: 0.05, q1: 0.035, q2: 0.06 }[key];
  const errors: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  const detection: Record<string, { before: number; after: number }> = {};
  for (let seed = first; seed <= last; seed++) {
    const values: Record<string, number[]> = { correct: [] };
    function capture(name: string, value: number) {
      values[name] ??= [];
      values[name].push(value);
    }
    const outcome = await item.check({
      seed,
      root: process.cwd(),
      rng: itemRng(seed, item.id),
      s: {
        ...stats,
        chaoCoverage: (counts) => {
          const a = stats.chaoCoverage(counts);
          capture('correct', a.chao1);
          if (mutants) {
            capture('observed-only', a.observed);
            capture('double-unseen', a.observed + 2 * (a.chao1 - a.observed));
            capture('jackknife', a.observed + a.f1 * (1 - 1 / a.n));
            capture('times-1.1', a.chao1 * 1.1);
            capture('times-0.9', a.chao1 * 0.9);
          }
          return a;
        },
        hillNumbers: (counts) => {
          const a = stats.hillNumbers(counts);
          capture('correct', a[key as 'q1' | 'q2']);
          if (mutants) {
            capture('other-order', key === 'q1' ? a.q2 : a.q1);
            capture('richness', a.q0);
            capture('order-2.2', stats.hillNumber(counts, 2.2));
            capture('times-1.1', a[key as 'q1' | 'q2'] * 1.1);
            capture('times-0.9', a[key as 'q1' | 'q2'] * 0.9);
          }
          return a;
        },
      },
    });
    for (const [name, xs] of Object.entries(values)) {
      if (xs.length !== 4) throw new Error(`Expected four samples: ${item.id}, ${xs.length}`);
      const e1 = Math.abs((xs[0] as number) - truth) / truth;
      const e4 = Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - truth) / truth;
      if (name === 'correct') {
        if (outcome.pass !== e4 <= newBar) throw new Error('Observer disagrees with item');
        errors.push(e4);
        if (e1 > oldBar) before.push(seed);
        if (e4 > newBar) after.push(seed);
      } else {
        detection[name] ??= { before: 0, after: 0 };
        const d = detection[name];
        if (e1 > oldBar) d.before++;
        if (e4 > newBar) d.after++;
      }
    }
  }
  errors.sort((a, b) => a - b);
  const result = {
    id: item.id,
    first,
    last,
    seeds: last - first + 1,
    oldBar,
    newBar,
    before,
    after,
    quantile9999: errors[Math.floor(errors.length * 0.9999)],
    max: errors.at(-1),
    zeroFailureUpper95: after.length ? undefined : 1 - 0.05 ** (1 / errors.length),
    detection,
  };
  results.push(result);
  console.error(JSON.stringify(result));
}
console.log(JSON.stringify(results, null, 2));
