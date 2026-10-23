import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkRegressionReport,
  ladderVersion,
  readFloors,
  readRegressionSeeds,
  registeredLadders,
  regressionThrough,
} from '../../packages/validators/src/index';

// Usage:
//   node --import tsx tools/ci/check-regression-seed.ts level <id>
//     prints the last level the entry `id` of validators/regression-seeds.json runs: its own `through`, or the floor of
//     its validator (validators/floors.json, at the registered ladder version) when that is higher.
//   node --import tsx tools/ci/check-regression-seed.ts check <id> <report.json>
//     exits 1 unless the report holds the seed of the entry alone and the seed passes every level from 1 through that level.
const [command, id, reportPath] = process.argv.slice(2);
if ((command !== 'level' && command !== 'check') || !id || (command === 'check' && !reportPath)) {
  console.error('usage: check-regression-seed.ts level <id> | check <id> <report.json>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../..');
const ladders = registeredLadders();
const tops = Object.fromEntries(
  Object.entries(ladders).map(([name, ladder]) => [name, ladder.levels.length]),
);
const entry = readRegressionSeeds(root, tops).find((candidate) => candidate.id === id);
const ladder = entry ? ladders[entry.component] : undefined;
if (!entry || !ladder) {
  console.error(`validators/regression-seeds.json has no entry ${id}.`);
  process.exit(2);
}
const through = regressionThrough(entry, readFloors(root), ladderVersion(ladder), ladder.levels.length);
if (command === 'level') {
  console.log(String(through));
  process.exit(0);
}
const problems = checkRegressionReport(
  entry,
  JSON.parse(readFileSync(resolve(reportPath as string), 'utf8')),
  through,
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::regression seed ${problem}`);
  console.error(`Defect on record: ${entry.defect} (fixed by ${entry.fixedBy}; evidence: ${entry.evidence})`);
  process.exit(1);
}
console.log(`${entry.id}: levels 1 to ${through} pass.`);
