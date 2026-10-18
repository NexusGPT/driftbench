/** Add exact paired tests of wall time and balance without rerunning or rounding measurements. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { exactContinuousPaired } from './continuous-paired';
import { spread } from './statistics';

const grid = JSON.parse(await readFile('comparisons/budget/full-results.json', 'utf8')) as {
  provenance: { sourceCommit: string };
  samples: Array<{ budget: number; method: string; seed: number; wallMs: number; maxDeviation: number }>;
};
const comparisons = [20, 50, 100, 200].flatMap((budget) =>
  ['pairwise', 'random'].map((control) => {
    const own = (method: string) =>
      grid.samples
        .filter((row) => row.budget === budget && row.method === method)
        .sort((a, b) => a.seed - b.seed);
    const hybrid = own('hybrid');
    const baseline = own(control);
    if (
      hybrid.length !== 30 ||
      baseline.length !== 30 ||
      hybrid.some((row, i) => row.seed !== baseline[i]?.seed)
    )
      throw new Error('Incomplete paired seeds');
    return {
      budget,
      control,
      metrics: Object.fromEntries(
        (['wallMs', 'maxDeviation'] as const).map((metric) => {
          const left = hybrid.map((row) => row[metric]);
          const right = baseline.map((row) => row[metric]);
          return [
            metric,
            {
              ...exactContinuousPaired(left, right),
              differenceSummary: spread(left.map((value, i) => value - (right[i] as number))),
            },
          ];
        }),
      ),
    };
  }),
);
await writeFile(
  'comparisons/budget/time-balance-results.json',
  `${JSON.stringify(
    {
      provenance: {
        measurementSourceCommit: grid.provenance.sourceCommit,
        analysisSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        analysedAt: new Date().toISOString(),
      },
      policy: {
        input: 'comparisons/budget/full-results.json',
        noTimingRerun: true,
        noRoundingBeforeTest: true,
        null: 'exchangeable method labels within each seed pair, independent swaps across pairs',
        multiplicity: 'unadjusted tests',
        wallTime: 'shared-machine observations; no causal runtime claim',
      },
      comparisons,
    },
    null,
    2,
  )}\n`,
);
console.log('Wrote exact paired wall-time and balance tests for all eight comparisons.');
