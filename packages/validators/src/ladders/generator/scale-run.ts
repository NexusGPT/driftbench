/**
 * The generator's scale items alone, as a script (docs/validators.md section 3.1):
 *
 *   node --import tsx packages/validators/src/ladders/generator/scale-run.ts [--seed 1] [--repeat 1] [--plants]
 *
 * The ladder stops at its first failing level, so a run of the whole validator never reaches the scale level
 * while a lower level fails. This script runs the 20 scale items of the bank on one seed, `--repeat` times, each
 * time with fresh scale runs at 10 and 100 times the behaviours. For each run it prints the CPU time, the
 * reference unit, its sample count and the units, then every failing item with its detail. It exits 1 when any
 * item fails on any repeat, 0 otherwise.
 *
 * `--plants` then runs the 100 times size once for each planted product of the scale tests: twice as slow and
 * quadratic must fail the time item, and a host three times slower must give the verdict of the clean runs.
 * A planted run that does not, exits 1 as well: the measure no longer tells them apart on this host.
 */
import { fileURLToPath } from 'node:url';
import { bankItems, SeedData } from './bank';
import { evaluate } from './index';
import { SCALE_BUDGET_UNITS, type ScaleReport, scaleReport, timeVerdict } from './scale';

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const value = at < 0 ? fallback : Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} takes a whole number from 1`);
  return value;
}

const seed = option('--seed', 1);
const repeat = option('--repeat', 1);
const items = bankItems().filter((item) => item.family === 'scale');
let failing = 0;
for (let round = 1; round <= repeat; round += 1) {
  const reports = new Map<number, Promise<ScaleReport>>();
  const scaled = (factor: number) => {
    let found = reports.get(factor);
    if (!found) {
      found = scaleReport(factor, seed);
      reports.set(factor, found);
    }
    return found;
  };
  // The factors run one after the other, as the ladder runs them, so the two never share the host.
  for (const factor of [10, 100]) {
    const report = await scaled(factor);
    const units = report.unitMs > 0 ? report.ms / report.unitMs : Number.NaN;
    process.stdout.write(
      `${JSON.stringify({
        round,
        seed,
        factor,
        ms: report.ms,
        unitMs: Number(report.unitMs.toFixed(2)),
        unitSamples: report.unitSamples,
        units: Number.isFinite(units) ? Math.round(units) : null,
        budgetUnits: SCALE_BUDGET_UNITS[factor] ?? null,
        ...(report.error ? { error: report.error } : {}),
      })}\n`,
    );
  }
  const results = await evaluate(items, new SeedData(seed, {}, scaled));
  for (const { item, verdict } of results) {
    if (verdict.pass) continue;
    failing += 1;
    process.stdout.write(`round ${round} FAIL ${item.id}: ${verdict.detail}\n`);
  }
  process.stdout.write(
    `round ${round}: ${results.filter((result) => result.verdict.pass).length} of ${results.length} scale items pass\n`,
  );
}

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../test/generator/fixtures/${name}`, import.meta.url));
const plants: Array<{
  name: string;
  options: Parameters<typeof scaleReport>[3];
  env?: Record<string, string>;
  fails: boolean | 'clean';
}> = [
  { name: 'twice as slow', options: { generator: fixture('slow-product.ts') }, fails: true },
  {
    name: 'quadratic',
    options: { generator: fixture('quadratic-product.ts') },
    env: { DRIFTBENCH_QUADRATIC_US: '0.012' },
    fails: true,
  },
  {
    name: 'host three times slower',
    options: { generator: fixture('slow-host.ts'), unitImport: fixture('slow-host.ts') },
    fails: 'clean',
  },
];
if (process.argv.includes('--plants')) {
  const clean = timeVerdict(await scaleReport(100, seed))[0];
  for (const plant of plants) {
    for (const [key, value] of Object.entries(plant.env ?? {})) process.env[key] = value;
    const report = await scaleReport(100, seed, undefined, plant.options);
    for (const key of Object.keys(plant.env ?? {})) delete process.env[key];
    const [pass, detail] = timeVerdict(report);
    const wanted = plant.fails === 'clean' ? clean : !plant.fails;
    process.stdout.write(
      `${JSON.stringify({ plant: plant.name, seed, factor: 100, ms: report.ms, unitMs: Number(report.unitMs.toFixed(2)), unitSamples: report.unitSamples, units: report.unitMs > 0 ? Math.round(report.ms / report.unitMs) : null, timePass: pass, wantedPass: wanted, ...(report.error ? { error: report.error } : {}) })}\n`,
    );
    if (pass !== wanted) {
      failing += 1;
      process.stdout.write(
        `plant ${plant.name}: the time item gave ${pass ? 'pass' : 'fail'}, wanted ${wanted ? 'pass' : 'fail'}: ${detail}\n`,
      );
    }
  }
}
process.exitCode = failing > 0 ? 1 : 0;
