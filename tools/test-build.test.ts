import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildJavaScript } from './test-build';

it('redirects the real build command into a disposable package and leaves shared dist untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'test-build-fixture-'));
  const path = process.env.PATH;
  try {
    const folder = join(root, 'packages/fixture');
    const scratch = join(root, 'scratch');
    const bin = join(root, 'bin');
    mkdirSync(join(folder, 'dist'), { recursive: true });
    mkdirSync(join(folder, 'node_modules'), { recursive: true });
    mkdirSync(join(folder, 'objects'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(folder, 'dist/index.js'), 'export const mde = 1;');
    writeFileSync(join(folder, 'objects/policy.yaml'), 'fictional: true');
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsup src/index.ts --format esm --dts --clean --target node22' } }),
    );
    // This stand-in fails if output is not explicitly redirected, then writes exactly where tsup would.
    writeFileSync(
      join(bin, 'pnpm'),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const at = args.indexOf('--out-dir');
if (at < 0) throw new Error('shared output would be overwritten');
const out = args[at + 1];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.js'), 'export const mde = 2;');
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ cwd: process.cwd(), args }));
`,
    );
    chmodSync(join(bin, 'pnpm'), 0o755);
    process.env.PATH = `${bin}:${path}`;
    buildJavaScript(root, scratch);
    expect(readFileSync(join(folder, 'dist/index.js'), 'utf8')).toBe('export const mde = 1;');
    expect(readFileSync(join(scratch, 'fixture/dist/index.js'), 'utf8')).toBe('export const mde = 2;');
    expect(readFileSync(join(scratch, 'fixture/objects/policy.yaml'), 'utf8')).toBe('fictional: true');
    expect(realpathSync(join(scratch, 'fixture/node_modules'))).toBe(
      realpathSync(join(folder, 'node_modules')),
    );
    const build = JSON.parse(readFileSync(join(scratch, 'fixture/dist/build.json'), 'utf8'));
    expect(build.cwd).toBe(folder);
    expect(build.args).toEqual([
      'exec',
      'tsup',
      'src/index.ts',
      '--format',
      'esm',
      '--clean',
      '--target',
      'node22',
      '--out-dir',
      join(scratch, 'fixture/dist'),
      '--silent',
    ]);
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});
