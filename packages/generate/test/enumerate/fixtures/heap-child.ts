/**
 * The child of the bounded-heap test: `node --max-old-space-size=<mb> --import tsx heap-child.ts <eager|disk>
 * <factor> <out>`. It generates the generator validator's hidden map of seed 1 with `factor` times its
 * behaviours, with the eager API (every file in memory) or the disk API, and prints the spec count.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_FILES, renderMap } from '../../../../validators/src/ladders/generator/render';
import { scaledSpec } from '../../../../validators/src/ladders/generator/scale';
import { generateSuite, generateSuiteToDisk, loadApprovedMap } from '../../../src/enumerate';

const [mode, factorText, out] = process.argv.slice(2);
if (!out) throw new Error('usage: heap-child.ts <eager|disk> <factor> <out>');
const mapDir = join(out, 'map');
mkdirSync(mapDir, { recursive: true });
const rendered = renderMap(scaledSpec(1, Number(factorText)));
for (const [key, name] of Object.entries(MAP_FILES))
  writeFileSync(join(mapDir, name), rendered[key as keyof typeof rendered]);
const loaded = await loadApprovedMap(join(mapDir, MAP_FILES.map));
if (!loaded.ok) throw new Error(loaded.message);
const options = { seed: 1, mapPath: '../map/approved.yaml' };
const specs =
  mode === 'eager'
    ? generateSuite(loaded.prepared, options).report.summary.specs
    : generateSuiteToDisk(loaded.prepared, { ...options, outputDir: join(out, 'suite') }).summary.specs;
process.stdout.write(`${specs}\n`);
