import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type Frame, finishInvocation, forgetSealedProducts, isolate } from '../../src/frame';
import { findRoot } from '../../src/root';

vi.setConfig({ testTimeout: 300_000 });
let work = '';
beforeAll(() => {
  const cache = join(findRoot(dirname(fileURLToPath(import.meta.url))), 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-module-paths-')));
});
afterAll(() => {
  finishInvocation();
  forgetSealedProducts();
  rmSync(work, { recursive: true, force: true });
});

type Paths = { url: string; dirname: string; filename: string; values: number[]; literal: string; template: string };
const ownPaths = (module: string, value: number): Paths => ({
  url: pathToFileURL(module).href,
  dirname: dirname(module),
  filename: module,
  values: [value, value, value],
  literal: 'import.meta.url import.meta.dirname import.meta.filename',
  template: `module ${pathToFileURL(module).href}`,
});

function reader(typed: boolean): string {
  return `import fs from 'node:fs';
import { dirname, join } from 'node:path';
export function read() {
  const value${typed ? ': number' : ''} = Number(fs.readFileSync(new URL('./asset.txt', import.meta.url), 'utf8'));
  return {
    url: import.meta.url,
    dirname: import.meta.dirname,
    filename: import.meta.filename,
    values: [value, Number(fs.readFileSync(join(import.meta.dirname, 'asset.txt'), 'utf8')),
      Number(fs.readFileSync(join(dirname(import.meta.filename), 'asset.txt'), 'utf8'))],
    literal: 'import.meta.url import.meta.dirname import.meta.filename',
    template: \`module \${import.meta.url}\`,
  };
}
`;
}

it.each(['mjs', 'ts'])('keeps the sibling asset and all three paths of a nested %s module', (extension) => {
  const tree = join(work, extension);
  const child = join(tree, 'nested');
  mkdirSync(child, { recursive: true });
  const entry = join(tree, `index.${extension}`);
  const module = join(child, `read.${extension}`);
  writeFileSync(join(tree, 'asset.txt'), '11');
  writeFileSync(join(child, 'asset.txt'), '137');
  writeFileSync(module, reader(extension === 'ts'));
  writeFileSync(entry, `export { read } from './nested/read.${extension}';\n`);
  let frame: Frame<{ read: () => Paths }> | undefined;
  try {
    frame = isolate({ module: entry, seed: 969, reads: [join(tree, 'asset.txt'), join(child, 'asset.txt')] });
    expect(frame.product.read()).toEqual(ownPaths(module, 137));
    expect(frame.tape[0]?.plain).toEqual({ ret: ownPaths(module, 137) });
    expect(frame.divergence()).toBeUndefined();
  } finally {
    frame?.close();
  }
});

it('keeps the entry module paths as the positive control', () => {
  const tree = join(work, 'entry');
  mkdirSync(tree);
  const entry = join(tree, 'index.mjs');
  const asset = join(tree, 'asset.txt');
  writeFileSync(asset, '137');
  writeFileSync(entry, reader(false));
  let frame: Frame<{ read: () => Paths }> | undefined;
  try {
    frame = isolate({ module: entry, seed: 970, reads: [asset] });
    expect(frame.product.read()).toEqual(ownPaths(entry, 137));
    expect(frame.divergence()).toBeUndefined();
  } finally {
    frame?.close();
  }
});
