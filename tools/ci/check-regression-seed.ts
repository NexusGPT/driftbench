import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkRegressionReport,
  readRegressionSeeds,
  registeredLadders,
} from '../../packages/validators/src/index';

// Usage: node --import tsx tools/ci/check-regression-seed.ts <id> <report.json>
// Exits 1 unless the report holds the seed of the entry `id` of validators/regression-seeds.json and the seed passes
// every level from 1 through the entry's `through`.
const [id, reportPath] = process.argv.slice(2);
if (!id || !reportPath) {
  console.error('usage: check-regression-seed.ts <id> <report.json>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../..');
const tops = Object.fromEntries(
  Object.entries(registeredLadders()).map(([name, ladder]) => [name, ladder.levels.length]),
);
const entry = readRegressionSeeds(root, tops).find((candidate) => candidate.id === id);
if (!entry) {
  console.error(`validators/regression-seeds.json has no entry ${id}.`);
  process.exit(2);
}
const problems = checkRegressionReport(entry, JSON.parse(readFileSync(resolve(reportPath), 'utf8')));
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::regression seed ${problem}`);
  console.error(`Defect on record: ${entry.defect} (fixed by ${entry.fixedBy}; evidence: ${entry.evidence})`);
  process.exit(1);
}
console.log(`${entry.id}: levels 1 to ${entry.through} pass.`);
