/** Offline opening-pair coverage and cheater assay. Run with node --import tsx. */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { cellsOf, generateSuite, measuredCoverage } from '../../packages/generate/src/enumerate/generate';
import { CHEATERS } from '../../packages/validators/src/ladders/generator/cheaters';
import { generateFrom, runAll } from '../../packages/validators/src/ladders/generator/measure';
import { renderMap } from '../../packages/validators/src/ladders/generator/render';
import { scaledSpec } from '../../packages/validators/src/ladders/generator/scale';

const output = process.argv[2] ?? '.exec/opening.json';
const hidden = scaledSpec(1, 10);
const generated = await generateFrom(
  hidden,
  renderMap(hidden),
  1,
  {
    generate: (prepared, options) => generateSuite(prepared, { ...options, t: 3 }),
  },
  { once: true },
);
if (!generated.prepared || generated.refused) throw new Error(JSON.stringify(generated.refused));
const suite = generated.complete.map(({ spec }) => spec);
const runs = await runAll(generated, { k: 1, faults: () => [] });
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  at: new Date().toISOString(),
  seed: 1,
  factor: 10,
  strength: 3,
  specs: suite.length,
  blocks: runs.blocks.length,
  pair: measuredCoverage(generated.prepared, suite, 2),
  uncovered: cellsOf(generated.prepared, suite, 2)
    .filter((cell) => cell.count === 0)
    .map((cell) => cell.values),
  cheaters: Object.fromEntries(
    CHEATERS.map((name) => [
      name,
      {
        passes: runs.blocks.filter((block) => block.cheaters[name]?.outcome === 'pass').length,
        witnesses: runs.blocks
          .filter((block) => block.cheaters[name]?.outcome === 'pass')
          .map((block) => block.key),
      },
    ]),
  ),
  followerFailures: runs.blocks
    .filter((block) => block.reference.some((outcome) => outcome !== 'pass'))
    .map((block) => ({ key: block.key, failures: block.referenceFailing })),
  errors: runs.errors,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ...report,
      uncovered: report.uncovered.length,
      cheaters: Object.fromEntries(Object.entries(report.cheaters).map(([name, row]) => [name, row.passes])),
    },
    null,
    2,
  ),
);
