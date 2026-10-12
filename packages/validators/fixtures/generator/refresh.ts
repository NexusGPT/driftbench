/**
 * Rewrites the seed 1 fixture of the generator validator from the code:
 *   pnpm exec tsx --tsconfig tsconfig.json packages/validators/fixtures/generator/refresh.ts
 * Run it only when the hidden specification or its rendering changes on purpose, and commit the diff with
 * the reason. The golden test in packages/validators/test/generator/hidden.test.ts compares against it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../src/ladders/generator/render';

const folder = join(fileURLToPath(new URL('.', import.meta.url)), 'seed-1');
mkdirSync(folder, { recursive: true });
const spec = hiddenSpec(1);
const files = renderMap(spec);
for (const [key, name] of Object.entries(MAP_FILES)) {
  writeFileSync(join(folder, name), files[key as keyof typeof files]);
}
const json = join(folder, 'hidden.json');
writeFileSync(json, `${JSON.stringify(spec, null, 2)}\n`);
// The repository's formatter owns JSON layout: format the file as biome check expects it.
execFileSync('pnpm', ['-s', 'exec', 'biome', 'format', '--write', json], { stdio: 'inherit' });
