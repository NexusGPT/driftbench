import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The release build runs the variables bank through the frame too (docs/validators.md section 12.9): the built
 * index starts its own bundled child, dist/variables-bank/child.js, which calls the implementation in confined runs.
 * The test builds the package as the release does, keeps one bank item, and runs the ladder of the built index with
 * an implementation that answers right only where no permission model runs: in the bank's own process it would pass,
 * under the frame it fails. The honest adapter passes the same item.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGE = join(ROOT, 'packages/validators');
const ITEM = 'blind.weights.interval.five-of-ten';
const UNCONFINED = fileURLToPath(new URL('./fixtures/cheats/unconfined.ts', import.meta.url));
let scratch: string;
let built: string;

/** Builds the release runtime of a copy of the package whose variables ladder keeps the one item. */
function build(): string {
  const mirror = join(scratch, 'compiled');
  const dir = join(mirror, 'packages/validators');
  mkdirSync(dir, { recursive: true });
  for (const sibling of readdirSync(join(ROOT, 'packages'))) {
    if (sibling !== 'validators')
      symlinkSync(join(ROOT, 'packages', sibling), join(mirror, 'packages', sibling), 'dir');
  }
  cpSync(join(PACKAGE, 'src'), join(dir, 'src'), { recursive: true });
  const ladder = join(dir, 'src/ladders/variables/index.ts');
  const text = readFileSync(ladder, 'utf8');
  expect(text).toContain('options.filter ?? (() => true)');
  writeFileSync(
    ladder,
    text.replace(
      'options.filter ?? (() => true)',
      `options.filter ?? ((item) => item.id === ${JSON.stringify(ITEM)})`,
    ),
  );
  cpSync(join(PACKAGE, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(PACKAGE, 'fixtures'), join(dir, 'fixtures'), 'dir');
  symlinkSync(join(PACKAGE, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.base.json'),
      compilerOptions: { typeRoots: [join(ROOT, 'node_modules/@types')] },
    }),
  );
  const result = spawnSync('pnpm', ['run', 'build:runtime'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return dir;
}

/** The item's outcome from the variables ladder of the built index, with `impl` as the implementation. */
function outcome(impl?: string): { pass: boolean; detail?: string } {
  const script = [
    `import { registeredLadders } from ${JSON.stringify(pathToFileURL(join(built, 'dist/index.js')).href)};`,
    'const ladder = registeredLadders().variables;',
    "const level = ladder.levels.find((each) => each.id === 'constraints');",
    `const measure = await level.compute({ seed: 1, root: ${JSON.stringify(ROOT)} });`,
    'process.stdout.write(JSON.stringify(measure));',
  ].join('\n');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DRIFTBENCH_VARIABLES_IMPL;
  if (impl) env.DRIFTBENCH_VARIABLES_IMPL = impl;
  const ran = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 300_000,
  });
  expect(ran.status, ran.stdout + ran.stderr).toBe(0);
  const text = ran.stdout;
  type Row = { id: string; pass: boolean; detail?: string };
  const items = (JSON.parse(text) as { bank?: Row[] }).bank ?? [];
  const found = items.find((each) => each.id === ITEM);
  expect(found, text.slice(0, 2000)).toBeDefined();
  return found as { pass: boolean; detail?: string };
}

describe('the release-built variables ladder', { timeout: 600_000 }, () => {
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'variables-built-child-'));
    built = build();
  }, 300_000);
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('holds its own bundled child', () => {
    expect(readdirSync(join(built, 'dist/variables-bank'))).toContain('child.js');
  });

  it('runs the implementation under the frame: an answer right only outside the frame fails', () => {
    const got = outcome(UNCONFINED);
    expect(got.pass).toBe(false);
  });

  it('passes the honest adapter on the same item', () => {
    expect(outcome().pass).toBe(true);
  });
});
