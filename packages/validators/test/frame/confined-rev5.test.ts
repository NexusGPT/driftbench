import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate } from '../../src/frame';
import { findRoot } from '../../src/root';

/**
 * The probes of the review of PR 969 at eb5135afc (sonnet-review-pool-5; fictional code), as the review wrote them,
 * with one change: the tsconfig.json the probes edit belongs to a project root of their own (a folder with a
 * pnpm-workspace.yaml) and not to the repository, so a test that rewrites it cannot disturb a test file that runs at
 * the same time. Run C is the unconfined, user-shaped run. It reads the file of expected values, then writes something
 * a LATER frame bundles. A frame that answers right on a later seed, with no divergence, carried the expected values
 * through the write.
 */
vi.setConfig({ testTimeout: 300_000 });

const repo = findRoot(dirname(fileURLToPath(import.meta.url)));
let work = '';
let oracle = '';
// esbuild applies no tsconfig.json to a file inside node_modules, so the tsconfig probes live outside it.
let outside = '';
let tsconfig = '';
const tsconfigBefore = '{"compilerOptions":{"target":"es2022"}}';

function install(name: string, base: string = work): string {
  const dir = join(base, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `{"name":"${name}","version":"1.0.0","type":"module","main":"index.mjs"}`,
  );
  writeFileSync(join(dir, 'index.mjs'), 'export const STAMP = 0;\n');
  return dir;
}

beforeAll(() => {
  const cache = join(repo, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-rev5-')));
  mkdirSync(join(work, 'tree'));
  mkdirSync(join(work, 'oracle'));
  oracle = join(work, 'oracle', 'expected.json');
  writeFileSync(oracle, '137');
  // Inside the repository's ignored cache folder: the loader of run C (resolved from its working folder) is found,
  // and no folder appears in the tracked tree while the test runs.
  outside = realpathSync(mkdtempSync(join(repo, 'node_modules', '.cache', 'zz-rev5-')));
  writeFileSync(join(outside, 'pnpm-workspace.yaml'), 'packages: []\n');
  tsconfig = join(outside, 'tsconfig.json');
  writeFileSync(tsconfig, tsconfigBefore);
  mkdirSync(join(outside, 'tree'));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
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
        `seed ${seed}: value ${value}, divergence ${divergence === undefined ? 'none' : divergence.slice(0, 400)}`,
      );
      return value === 137 && divergence === undefined;
    } catch (cause) {
      notes.push(
        `seed ${seed}: refused: ${String(cause instanceof Error ? cause.message : cause).slice(0, 160)}`,
      );
      return false;
    } finally {
      frame?.close();
    }
  });
  return { rows, notes };
}

describe('probes of the review of PR 969 at eb5135afc', () => {
  it('control 2: when the paths of tsconfig.json map the import before the frame, the bundle takes the mapped file', () => {
    const pkg = install('zzdepthree', outside);
    const planted = join(pkg, 'planted.mjs');
    writeFileSync(planted, `export const STAMP = ${Date.now()};\n`);
    const cfg = JSON.parse(tsconfigBefore) as { compilerOptions?: Record<string, unknown> };
    cfg.compilerOptions = {
      ...(cfg.compilerOptions ?? {}),
      paths: { zzdepthree: [`./${relative(outside, planted)}`] },
    };
    writeFileSync(tsconfig, JSON.stringify(cfg));
    const module = join(outside, 'tree', 'three.mjs');
    writeFileSync(
      module,
      "import { STAMP } from 'zzdepthree';\nexport const get = () => (Date.now() - STAMP < 3600000 ? 137 : 0);\n",
    );
    const { rows, notes } = frames(module);
    writeFileSync(tsconfig, tsconfigBefore);
    expect(rows, notes.join(' | ')).toEqual([true, true, true, true]);
  });

  it('probe 1: run C edits package.json and adds a file inside an existing node_modules package', () => {
    const pkg = install('zzdepone');
    const module = join(work, 'tree', 'one.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzdepone';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(join(pkg, 'stamp.mjs'))})) {
    fs.writeFileSync(${JSON.stringify(join(pkg, 'stamp.mjs'))}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(pkg, 'package.json'))}, '{"name":"zzdepone","version":"1.0.0","type":"module","main":"stamp.mjs"}');
  }
} catch {}
export const get = () => (Date.now() - STAMP < 3600000 ? 137 : 0);
`,
    );
    const { rows, notes } = frames(module);
    expect(rows, notes.join(' | ')).toEqual([false, false, false, false]);
  });

  it('probe 2: run C edits the paths of the project tsconfig.json to a file it planted inside an existing package', () => {
    const pkg = install('zzdeptwo', outside);
    const module = join(outside, 'tree', 'two.mjs');
    const planted = join(pkg, 'planted.mjs');
    const target = `./${relative(outside, planted)}`;
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzdeptwo';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(planted)})) {
    fs.writeFileSync(${JSON.stringify(planted)}, 'export const STAMP = ' + Date.now() + ';\\n');
    const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(tsconfig)}, 'utf8'));
    cfg.compilerOptions = { ...(cfg.compilerOptions || {}), paths: { zzdeptwo: [${JSON.stringify(target)}] } };
    fs.writeFileSync(${JSON.stringify(tsconfig)}, JSON.stringify(cfg));
  }
} catch {}
export const get = () => (Date.now() - STAMP < 3600000 ? 137 : 0);
`,
    );
    const { rows, notes } = frames(module);
    expect(existsSync(planted), notes.join(' | ')).toBe(true);
    expect(JSON.parse(readFileSync(tsconfig, 'utf8')).compilerOptions.paths).toBeDefined();
    writeFileSync(tsconfig, tsconfigBefore);
    expect(rows, notes.join(' | ')).toEqual([false, false, false, false]);
  });
});
