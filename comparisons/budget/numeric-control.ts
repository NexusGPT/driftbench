/** Numeric ablation on identical categorical rows: pnpm exec tsx comparisons/budget/numeric-control.ts. */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { loadApprovedMap } from '@agent-nexus/driftbench-generate';
import { renderDraft } from '../../packages/generate/src/seed/assemble';
import { range, rngFor } from '../../packages/generate/src/seed/random';
import { budgetSeeder } from '../../packages/generate/src/seed/seeders';
import { bandCounts } from './numeric-strata';
import { analysisPolicy, paired, spread } from './statistics';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const mapPath = 'comparisons/budget/numeric/approved.yaml';
const loaded = await loadApprovedMap(mapPath);
if (!loaded.ok) throw new Error(JSON.stringify(loaded));
const prepared = loaded.prepared;
const budgets = [20, 50, 100, 200];
type Sample = {
  budget: number;
  seed: number;
  method: string;
  pairsCovered: number;
  rows: unknown[];
  globalBandsHit: number;
  globalBandsTotal: number;
  sliceBandsHit: number;
  sliceBandsTotal: number;
  perfectSliceSettings: number;
  sliceSettingsTotal: number;
  allGlobalSettingsPerfect: number;
  allSliceSettingsPerfect: number;
  strata: unknown[];
};
const samples: Sample[] = [];
for (const budget of budgets) {
  for (const seed of range(30).map((i) => i + 1)) {
    const generated = budgetSeeder(prepared, { seed, t: 2, max: Number.POSITIVE_INFINITY }, { budget });
    const numeric = generated.budget.numeric;
    if (!numeric || numeric.rows.length !== budget || numeric.settings.length !== 3)
      throw new Error('Numeric sampling absent');
    // Uniform control changes only the numeric quantiles, not one categorical row or its position.
    const rngs = new Map(
      numeric.settings.map((setting) => [setting.id, rngFor(seed, `budget:numeric:${setting.id}`)]),
    );
    const uniformRows = numeric.rows.map((row) => {
      const quantiles: Record<string, number> = {};
      const vars: Record<string, number> = {};
      for (const setting of numeric.settings) {
        const rng = rngs.get(setting.id);
        if (!rng) throw new Error('Missing random stream');
        const q = rng();
        quantiles[setting.id] = q;
        vars[setting.id] = setting.integer
          ? Math.ceil(setting.min) + Math.floor(q * (Math.floor(setting.max) - Math.ceil(setting.min) + 1))
          : setting.min + q * (setting.max - setting.min);
      }
      return { spec: row.spec, cell: row.cell, quantiles, vars };
    });
    const groups = new Map<string, number[]>();
    numeric.rows.forEach((row, index) => {
      const key = JSON.stringify(row.cell);
      groups.set(key, [...(groups.get(key) ?? []), index]);
    });
    const pairSet = (rows: typeof numeric.rows) => {
      const pairs = new Set<string>();
      for (const row of rows) {
        const dimensions = Object.keys(row.cell);
        dimensions.forEach((left, i) => {
          for (const right of dimensions.slice(i + 1))
            pairs.add(`${left}=${row.cell[left]}|${right}=${row.cell[right]}`);
        });
      }
      return pairs;
    };
    const lhsPairs = pairSet(numeric.rows);
    const uniformPairs = pairSet(uniformRows);
    if (
      JSON.stringify([...lhsPairs].sort()) !== JSON.stringify([...uniformPairs].sort()) ||
      lhsPairs.size !== generated.summary.covered
    )
      throw new Error('Numeric ablation changed categorical pair coverage');
    for (const [method, rows] of [
      ['sliced-lhs', numeric.rows],
      ['uniform', uniformRows],
    ] as const) {
      const strata = numeric.settings.map((setting) => ({
        setting: setting.id,
        global: bandCounts(rows.map((row) => row.quantiles[setting.id] as number)),
        slices: [...groups.entries()].map(([cell, indices]) => ({
          cell: JSON.parse(cell),
          size: indices.length,
          ...bandCounts(indices.map((index) => rows[index]?.quantiles[setting.id] as number)),
        })),
      }));
      if (
        method === 'sliced-lhs' &&
        strata.some((setting) => !setting.global.perfect || setting.slices.some((slice) => !slice.perfect))
      )
        throw new Error('Sliced LHS violates global or per-slice stratification');
      // Verify both sampling routes reach given.vars and preserve the rendered categorical metadata.
      for (const [index, draft] of generated.drafts.entries()) {
        const vars = rows[index]?.vars;
        const rendered = renderDraft(prepared, { ...draft, vars }, { seed, mapPath });
        const original = renderDraft(prepared, draft, { seed, mapPath });
        if (
          rendered.noThen.length ||
          rendered.placeholders.length ||
          JSON.stringify((rendered.spec.given as { vars?: unknown } | undefined)?.vars) !==
            JSON.stringify(vars)
        )
          throw new Error('Numeric row incomplete or vars not delivered');
        if (JSON.stringify(rendered.spec.metadata) !== JSON.stringify(original.spec.metadata))
          throw new Error('Numeric ablation changed categorical rendering');
      }
      samples.push({
        budget,
        seed,
        method,
        pairsCovered: lhsPairs.size,
        rows,
        globalBandsHit: strata.reduce((sum, setting) => sum + setting.global.hit, 0),
        globalBandsTotal: budget * numeric.settings.length,
        sliceBandsHit: strata.reduce(
          (sum, setting) => sum + setting.slices.reduce((n, slice) => n + slice.hit, 0),
          0,
        ),
        sliceBandsTotal: budget * numeric.settings.length,
        perfectSliceSettings: strata.reduce(
          (sum, setting) => sum + setting.slices.filter((slice) => slice.perfect).length,
          0,
        ),
        sliceSettingsTotal: groups.size * numeric.settings.length,
        allGlobalSettingsPerfect: strata.every((setting) => setting.global.perfect) ? 1 : 0,
        allSliceSettingsPerfect: strata.every((setting) => setting.slices.every((slice) => slice.perfect))
          ? 1
          : 0,
        strata,
      });
    }
  }
}
const metrics = [
  'pairsCovered',
  'globalBandsHit',
  'sliceBandsHit',
  'perfectSliceSettings',
  'sliceSettingsTotal',
  'allGlobalSettingsPerfect',
  'allSliceSettingsPerfect',
] as const;
const summaries = budgets.flatMap((budget) =>
  ['sliced-lhs', 'uniform'].map((method) => {
    const own = samples.filter((row) => row.budget === budget && row.method === method);
    return {
      budget,
      method,
      metrics: Object.fromEntries(metrics.map((metric) => [metric, spread(own.map((row) => row[metric]))])),
    };
  }),
);
const pairedTests = budgets.map((budget) => {
  const own = (method: string) =>
    samples.filter((row) => row.budget === budget && row.method === method).sort((a, b) => a.seed - b.seed);
  return {
    budget,
    metrics: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        paired(
          own('sliced-lhs').map((row) => row[metric]),
          own('uniform').map((row) => row[metric]),
        ),
      ]),
    ),
  };
});
const rawFiles = budgets.map((budget) => `comparisons/budget/numeric-${budget}-samples.json`);
for (const [index, budget] of budgets.entries()) {
  await writeFile(
    rawFiles[index] as string,
    `${JSON.stringify({ sourceCommit, budget, samples: samples.filter((row) => row.budget === budget) }, null, 2)}\n`,
  );
}
await writeFile(
  'comparisons/budget/numeric-results.json',
  `${JSON.stringify(
    {
      provenance: {
        sourceCommit,
        measuredAt: new Date().toISOString(),
        node: process.version,
        mapPath,
        mapHash: prepared.hash,
      },
      policy: {
        budgets,
        seeds: range(30).map((i) => i + 1),
        settings: prepared.numericSettings,
        categoricalPool:
          'six flow/channel/persona cells, repeated by production budgetSeeder with numeric ranges enabled',
        comparison:
          'production sliced LHS versus independent uniform quantiles on identical ordered categorical rows; same numeric rngFor seed/setting stream',
        strata:
          'equal-width quantile bands; N global bands and n_cell bands in each categorical cell; each setting scored separately',
        integer: 'stratification scored on latent quantiles, not integer levels; integer values may repeat',
        scope: 'sampling and given.vars delivery only; no numeric fault-detection inference',
        modelCalls: 0,
        usd: 0,
        ...analysisPolicy,
      },
      summaries,
      pairedTests,
      rawFiles,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${samples.length} numeric samples`);
