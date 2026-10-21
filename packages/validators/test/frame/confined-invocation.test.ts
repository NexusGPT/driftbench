import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type Frame,
  finishInvocation,
  forgetSealedProducts,
  isolate,
  RESOLUTION_CONFIG_NAMES,
} from '../../src/frame';
import { findRoot } from '../../src/root';

/**
 * The end of an invocation (docs/validators.md section 12.9): a tree that run C changed during the run is marked, and
 * the next invocation refuses to start on it. The probes are the new-file ones of the second review of PR 969 (a
 * tsconfig.json where none existed, a nearer project root above the product), which seal-once keeps from reaching a
 * later frame of the same invocation and this check catches for the next invocation.
 */
vi.setConfig({ testTimeout: 300_000 });

const repo = findRoot(dirname(fileURLToPath(import.meta.url)));
let work = '';
let oracle = '';
const roots: string[] = [];

const pkgJson = (name: string) => `{"name":"${name}","version":"1.0.0","type":"module","main":"index.mjs"}`;
function install(name: string, base: string): string {
  const dir = join(base, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), pkgJson(name));
  writeFileSync(join(dir, 'index.mjs'), 'export const STAMP = 0;\n');
  return dir;
}
function privateRoot(tag: string, withTsconfig: boolean): string {
  const dir = realpathSync(
    mkdtempSync(join(repo, 'packages', 'validators', 'test', 'frame', `zz-inv-${tag}-`)),
  );
  roots.push(dir);
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  if (withTsconfig) writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{"target":"es2022"}}');
  return dir;
}

beforeAll(() => {
  const cache = join(repo, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-inv-')));
  mkdirSync(join(work, 'oracle'));
  oracle = join(work, 'oracle', 'expected.json');
  writeFileSync(oracle, '137');
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function frames(module: string): boolean[] {
  return [1, 2, 3, 4].map((seed) => {
    let frame: Frame<{ get: () => number }> | undefined;
    try {
      frame = isolate<{ get: () => number }>({ module, seed });
      return frame.product.get() === 137 && frame.divergence() === undefined;
    } catch {
      return false;
    } finally {
      frame?.close();
    }
  });
}
const FRESH = 'Date.now() - STAMP < 3600000 ? 137 : 0';

describe('the end of an invocation', () => {
  it('names the resolution-config files it compares', () => {
    const names = RESOLUTION_CONFIG_NAMES.map(String);
    for (const wanted of ['package.json', 'jsconfig.json', 'pnpm-workspace.yaml', '.npmrc', '.pnp.cjs'])
      expect(names).toContain(wanted);
    expect(
      RESOLUTION_CONFIG_NAMES.some((each) => each instanceof RegExp && each.test('tsconfig.base.json')),
    ).toBe(true);
  });

  it('T1: run C creates a tsconfig.json where none existed: the next invocation refuses the tree', () => {
    const root = privateRoot('t1', false);
    install('zzinvone', root);
    const spare = install('zzinvspare', root);
    const planted = join(spare, 'planted.mjs');
    mkdirSync(join(root, 'tree'));
    const module = join(root, 'tree', 't1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzinvone';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(planted)})) {
    fs.writeFileSync(${JSON.stringify(planted)}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(root, 'tsconfig.json'))}, JSON.stringify({ compilerOptions: { paths: { zzinvone: ['./node_modules/zzinvspare/planted.mjs'] } } }));
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    expect(frames(module)).toEqual([false, false, false, false]);
    const message = finishInvocation();
    expect(message).toMatch(/tsconfig\.json \(added\)/);
    // A new invocation: nothing is sealed any more, and the marked tree is refused.
    forgetSealedProducts();
    expect(() => isolate({ module, seed: 5 })).toThrow(/earlier run C changed the tree/);
  });

  it('R1: run C makes a nearer project root above the product: the next invocation refuses the tree', () => {
    const root = privateRoot('r1', true);
    install('zzinvtwo', root);
    const spare = install('zzinvspare2', root);
    const planted = join(spare, 'planted.mjs');
    const proj = join(root, 'proj');
    mkdirSync(join(proj, 'tree'), { recursive: true });
    const module = join(proj, 'tree', 'r1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from 'zzinvtwo';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(planted)})) {
    fs.writeFileSync(${JSON.stringify(planted)}, 'export const STAMP = ' + Date.now() + ';\\n');
    fs.writeFileSync(${JSON.stringify(join(proj, 'pnpm-workspace.yaml'))}, 'packages: []\\n');
    fs.writeFileSync(${JSON.stringify(join(proj, 'tsconfig.json'))}, JSON.stringify({ compilerOptions: { paths: { zzinvtwo: ['../node_modules/zzinvspare2/planted.mjs'] } } }));
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    expect(frames(module)).toEqual([false, false, false, false]);
    const message = finishInvocation();
    expect(message).toMatch(/pnpm-workspace\.yaml \(added\)/);
    forgetSealedProducts();
    expect(() => isolate({ module, seed: 5 })).toThrow(/earlier run C changed the tree/);
  });

  it('W1: run C adds a file beside a file of a declared workspace package that the bundle took: seen at the end', () => {
    // The root declares pkgs/* as workspace packages; the product imports one of them. A new util.tsx beside util.ts
    // would shadow it in the next bundle (esbuild tries .tsx before .ts): the whole source tree of the package is
    // watched, not only the files the bundle took.
    const root = privateRoot('w1', true);
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - pkgs/*\n');
    const dep = join(root, 'pkgs', 'dep');
    mkdirSync(join(dep, 'src'), { recursive: true });
    writeFileSync(join(dep, 'package.json'), '{"name":"dep","version":"1.0.0","type":"module"}');
    writeFileSync(join(dep, 'src', 'index.ts'), "export { STAMP } from './util';\n");
    writeFileSync(join(dep, 'src', 'util.ts'), 'export const STAMP = 0;\n');
    mkdirSync(join(root, 'tree'));
    const module = join(root, 'tree', 'w1.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
import { STAMP } from '../pkgs/dep/src/index.ts';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(join(dep, 'src', 'util.tsx'))})) {
    fs.writeFileSync(${JSON.stringify(join(dep, 'src', 'util.tsx'))}, 'export const STAMP = ' + Date.now() + ';\\n');
  }
} catch {}
export const get = () => (${FRESH});
`,
    );
    frames(module);
    const message = finishInvocation();
    expect(message).toMatch(/util\.tsx \(added\)/);
    forgetSealedProducts();
    expect(() => isolate({ module, seed: 5 })).toThrow(/earlier run C changed the tree/);
  });

  it('says nothing when nothing changed', () => {
    const root = privateRoot('quiet', true);
    mkdirSync(join(root, 'tree'));
    const module = join(root, 'tree', 'quiet.mjs');
    writeFileSync(module, 'export const get = () => 137;\n');
    expect(frames(module)).toEqual([true, true, true, true]);
    expect(finishInvocation()).toBeUndefined();
  });
});
