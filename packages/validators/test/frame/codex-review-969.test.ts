import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { type Frame, finishInvocation, forgetSealedProducts, isolate } from '../../src/frame';
import { findRoot } from '../../src/root';

it.each([false, true])('honest granted sibling read, imported submodule=%s', (nested) => {
  const cache = join(findRoot(dirname(fileURLToPath(import.meta.url))), 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const work = mkdtempSync(join(cache, 'codex-review-969-'));
  const product = join(work, 'product');
  const owner = nested ? join(product, 'sub') : product;
  mkdirSync(owner, { recursive: true });
  const data = join(owner, 'data.json');
  const entry = join(product, 'index.mjs');
  writeFileSync(data, '{"value":137}');
  const code = `import { readFileSync } from 'node:fs';
export const get = () => JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8')).value;
`;
  if (nested) {
    writeFileSync(join(owner, 'load.mjs'), code);
    writeFileSync(entry, "export { get } from './sub/load.mjs';\n");
  } else writeFileSync(entry, code);
  let frame: Frame<{ get: () => number }> | undefined;
  try {
    frame = isolate({ module: entry, seed: nested ? 902 : 901, reads: [data] });
    let value: number | undefined;
    let error: string | undefined;
    try { value = frame.product.get(); } catch (cause) { error = String(cause); }
    const divergence = frame.divergence();
    console.log(JSON.stringify({ nested, value, error, divergence, tape: frame.tape }));
    expect({ value, error, divergence }).toEqual({ value: 137, error: undefined, divergence: undefined });
  } finally {
    frame?.close();
    finishInvocation();
    forgetSealedProducts();
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);
