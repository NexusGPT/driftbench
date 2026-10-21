import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import { findRoot } from '../../src/root';

/**
 * Second round of review probes of PR 969 at 1306fcb56 (sonnet-review-pool-5; fictional code; not for merge).
 * Run C is the unconfined run. It reads the file of expected values, then writes something a LATER frame bundles.
 * Rows are the frames of seeds 1 to 4: true = answered right with no divergence and no refusal.
 */
vi.setConfig({ testTimeout: 300_000 });

const repo = findRoot(dirname(fileURLToPath(import.meta.url)));
let work = '';
let oracle = '';
const roots: string[] = [];

const pkgJson = (name: string, main = 'index.mjs') =>
  `{"name":"${name}","version":"1.0.0","type":"module","main":"${main}"}`;
function install(name: string, base: string, body = 'export const STAMP = 0;\n'): string {
  const dir = join(base, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), pkgJson(name));
  writeFileSync(join(dir, 'index.mjs'), body);
  return dir;
}
function privateRoot(tag: string, withTsconfig: boolean): string {
  const dir = realpathSync(
    mkdtempSync(join(repo, 'packages', 'validators', 'test', 'frame', `zz-rev5b-${tag}-`)),
  );
  roots.push(dir);
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  if (withTsconfig) writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{"target":"es2022"}}');
  return dir;
}

beforeAll(() => {
  const cache = join(repo, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-rev5b-')));
  mkdirSync(join(work, 'tree'));
  mkdirSync(join(work, 'oracle'));
  oracle = join(work, 'oracle', 'expected.json');
  writeFileSync(oracle, '137');
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function frames(module: string) {
  const notes: string[] = [];
  const rows = [1, 2, 3, 4].map((seed) => {
    let frame: Frame<{ get: () => number }> | undefined;
    try {
      frame = isolate<{ get: () => number }>({ module, seed });
      const value = frame.product.get();
      const divergence = frame.divergence();
      notes.push(
        `seed ${seed}: value ${value}, divergence ${divergence === undefined ? 'none' : divergence.slice(0, 300)}`,
      );
      return value === 137 && divergence === undefined;
    } catch (cause) {
      notes.push(
        `seed ${seed}: refused: ${String(cause instanceof Error ? cause.message : cause).slice(0, 200)}`,
      );
      return false;
    } finally {
      frame?.close();
    }
  });
  return { rows, notes };
}
const report = (name: string, r: { rows: boolean[]; notes: string[] }) =>
  console.log(`${name} ${JSON.stringify(r)}`);

const readOracle = () => `fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');`;
const FRESH = `Date.now() - STAMP < 3600000 ? 137 : 0`;

describe('second round of probes of PR 969 at 1306fcb56', () => {
  it('N1: run C plants a nearer copy of a dependency of a dependency, in the node_modules of the dependency', () => {
    install('zznested', work);
    const host = install('zzhost', work, "export { STAMP } from 'zznested';\n");
    const nearer = join(host, 'node_modules', 'zznested');
    mkdirSync(join(work, 'tree-n1'));
    const module = join(work, 'tree-n1', 'n1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzhost';
try {
  ${readOracle()}
  if (!fs.existsSync(${JSON.stringify(join(nearer, 'index.mjs'))})) {
    fs.mkdirSync(${JSON.stringify(nearer)}, { recursive: true });
    fs.writeFileSync(${JSON.stringify(join(nearer, 'package.json'))}, ${JSON.stringify(pkgJson('zznested'))});
    fs.writeFileSync(${JSON.stringify(join(nearer, 'index.mjs'))}, 'export const STAMP = ' + Date.now() + ';\\n');
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    const r = frames(module);
    report('N1', r);
    expect(r.rows, r.notes.join(' | ')).toEqual([false, false, false, false]);
  });

  it('N2: run C edits the package.json and adds a file inside a nested package that the bundle used', () => {
    const host = install('zzhost2', work, "export { STAMP } from 'zzinner';\n");
    const inner = install('zzinner', host);
    mkdirSync(join(work, 'tree-n2'));
    const module = join(work, 'tree-n2', 'n2.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzhost2';
try {
  ${readOracle()}
  if (!fs.existsSync(${JSON.stringify(join(inner, 'stamp.mjs'))})) {
    fs.writeFileSync(${JSON.stringify(join(inner, 'stamp.mjs'))}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(inner, 'package.json'))}, ${JSON.stringify(pkgJson('zzinner', 'stamp.mjs'))});
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    const r = frames(module);
    report('N2', r);
    expect(r.rows, r.notes.join(' | ')).toEqual([false, false, false, false]);
  });

  it('E1: a bundle input under the project cache folder is refused, not taken', () => {
    const cacheDir = join(repo, 'node_modules', '.cache', `rev5b-planted-${process.pid}`);
    mkdirSync(cacheDir, { recursive: true });
    roots.push(cacheDir);
    writeFileSync(join(cacheDir, 'stamp.mjs'), `export const STAMP = ${Date.now()};\n`);
    mkdirSync(join(work, 'tree-e1'));
    const module = join(work, 'tree-e1', 'e1.mjs');
    writeFileSync(
      module,
      `import { STAMP } from ${JSON.stringify(join(cacheDir, 'stamp.mjs'))};\nexport const get = () => (${FRESH});\n`,
    );
    const r = frames(module);
    report('E1', r);
    expect(r.rows, r.notes.join(' | ')).toEqual([false, false, false, false]);
  });

  it('T1: the project has no tsconfig.json; run C creates one with paths', () => {
    const root = privateRoot('t1', false);
    install('zzdepfive', root);
    const spare = install('zzspare5', root);
    const planted = join(spare, 'planted.mjs');
    mkdirSync(join(root, 'tree'));
    const module = join(root, 'tree', 't1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzdepfive';
try {
  ${readOracle()}
  if (!fs.existsSync(${JSON.stringify(planted)})) {
    fs.writeFileSync(${JSON.stringify(planted)}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(root, 'tsconfig.json'))}, JSON.stringify({ compilerOptions: { paths: { zzdepfive: ['./node_modules/zzspare5/planted.mjs'] } } }));
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    const r = frames(module);
    report('T1', r);
    expect(r.rows, r.notes.join(' | ')).toEqual([false, false, false, false]);
  });

  it('R1: run C makes a nearer project root (pnpm-workspace.yaml + tsconfig.json) above the product tree', () => {
    const root = privateRoot('r1', true);
    install('zzdepsix', root);
    const spare = install('zzspare6', root);
    const planted = join(spare, 'planted.mjs');
    const proj = join(root, 'proj');
    mkdirSync(join(proj, 'tree'), { recursive: true });
    const module = join(proj, 'tree', 'r1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzdepsix';
try {
  ${readOracle()}
  if (!fs.existsSync(${JSON.stringify(planted)})) {
    fs.writeFileSync(${JSON.stringify(planted)}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(proj, 'pnpm-workspace.yaml'))}, 'packages: []\\n');
    fs.writeFileSync(${JSON.stringify(join(proj, 'tsconfig.json'))}, JSON.stringify({ compilerOptions: { paths: { zzdepsix: ['../node_modules/zzspare6/planted.mjs'] } } }));
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    const r = frames(module);
    report('R1', r);
    expect(existsSync(planted), r.notes.join(' | ')).toBe(true);
    expect(r.rows, r.notes.join(' | ')).toEqual([false, false, false, false]);
  });
});
