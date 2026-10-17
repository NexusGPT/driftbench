/**
 * The generator's scale items alone, as a script (docs/validators.md section 3.1):
 *
 *   node --import tsx packages/validators/src/ladders/generator/scale-run.ts [--seed 1] [--repeat 1]
 *
 * The ladder stops at its first failing level, so a run of the whole validator never reaches the scale level
 * while a lower level fails. This script runs the 20 scale items of the bank on one seed, `--repeat` times, each
 * time with fresh scale runs at 10 and 100 times the behaviours. For each run it prints the CPU time, the
 * reference unit, its sample count and the units, then every failing item with its detail. It exits 1 when any
 * item fails on any repeat, 0 otherwise.
 */
import { bankItems, SeedData } from './bank';
import { evaluate } from './index';
import { SCALE_BUDGET_UNITS, type ScaleReport, scaleReport } from './scale';

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
process.exitCode = failing > 0 ? 1 : 0;
