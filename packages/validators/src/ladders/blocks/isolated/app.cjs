'use strict';
// The program that starts the isolated measure run of the blocks bank (docs/validators.md section 12.7).
// build.ts copies it as `app` beside the bundle; the CI job starts it as `node app` from the home folder, with an
// environment of HOME and PATH only, and hands it the run on standard input:
//   { "root", "bundle", "out", "seeds", "hidden", "head", "self" }
// It reads that, deletes itself and the file the run came from, registers tsx (the product is TypeScript) and a
// loader hook whose load reads the bundle, deletes it and returns its source, then runs the bank once and writes
// the report to "out". No product module is loaded before the bundle is gone from the disk.
const { readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createRequire, register } = require('node:module');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const LOADER = `
import { readFileSync, rmSync } from 'node:fs';
let bundle;
let source;
export function initialize(data) {
  bundle = data.bundle;
}
export async function load(url, context, nextLoad) {
  if (bundle !== undefined && url === bundle.url) {
    source ??= readFileSync(bundle.path, 'utf8');
    rmSync(bundle.path, { force: true });
    bundle = undefined;
    const text = source;
    source = undefined;
    return { format: 'module', source: text, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

async function main() {
  const run = JSON.parse(readFileSync(0, 'utf8'));
  rmSync(__filename, { force: true });
  if (run.self) rmSync(run.self, { force: true });
  process.argv = [process.argv[0], 'app'];
  process.chdir(homedir());
  const tsxFolder = dirname(createRequire(join(run.root, 'package.json')).resolve('tsx/package.json'));
  const tsx = await import(pathToFileURL(join(tsxFolder, 'dist/esm/api/index.mjs')).href);
  tsx.register({ tsconfig: join(run.root, 'tsconfig.json') });
  const url = pathToFileURL(run.bundle).href;
  register(`data:text/javascript,${encodeURIComponent(LOADER)}`, {
    data: { bundle: { url, path: run.bundle } },
  });
  const { measure } = await import(url);
  const result = await measure({
    root: run.root,
    seeds: run.seeds,
    hidden: run.hidden === true,
    head: run.head,
    ...(run.maxLevel === undefined ? {} : { maxLevel: run.maxLevel }),
  });
  writeFileSync(run.out, result.json);
  process.stdout.write(`level (exit code) ${result.level}\n`);
  return result.level;
}

main().then(
  (level) => {
    process.exit(level);
  },
  (cause) => {
    process.stderr.write(
      `the isolated run failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`,
    );
    process.exit(99);
  },
);
