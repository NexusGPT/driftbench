// The public API gate: the names every package exports are frozen in tools/structure/api-surface.json.
// A pull request that adds or removes a public name fails here until it regenerates that file
// (node tools/structure/api-surface.mjs --write), which puts the change in front of a reviewer.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TOOL = fileURLToPath(new URL('./api-surface.mjs', import.meta.url));
const SNAPSHOT = fileURLToPath(new URL('./api-surface.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

describe('public API', () => {
  it('matches the frozen list of exports', () => {
    const check = run('--check');
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  }, 120_000);

  it('names an export that was added and one that was removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'driftbench-api-'));
    try {
      const frozen = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
      const removed = Object.keys(frozen.packages.stats).find(
        (name) => frozen.packages.stats[name] === 'value',
      );
      delete frozen.packages.stats[removed];
      frozen.packages.stats.zzNeverExported = 'value';
      const altered = join(dir, 'api-surface.json');
      writeFileSync(altered, JSON.stringify(frozen));
      const check = run('--check', '--snapshot', altered);
      expect(check.status).toBe(1);
      expect(check.stderr).toContain(`  added    stats: value ${removed}`);
      expect(check.stderr).toContain('  removed  stats: value zzNeverExported');
      expect(check.stderr).toContain('node tools/structure/api-surface.mjs --write');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('no package entry re-exports a whole module: every public name is written out', () => {
    const packages = fileURLToPath(new URL('../../packages', import.meta.url));
    const starred = readdirSync(packages)
      .map((name) => join(packages, name, 'src/index.ts'))
      .filter((file) => existsSync(file) && /^export \* from /m.test(readFileSync(file, 'utf8')));
    expect(starred, 'write the names out: export { a, type B } from "./module"').toEqual([]);
  });

  it('the frozen list is sorted and holds every package', () => {
    const frozen = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    expect(Object.keys(frozen.packages).length).toBeGreaterThan(10);
    for (const names of Object.values(frozen.packages)) {
      expect(Object.keys(names)).toEqual(Object.keys(names).sort());
      expect(Object.values(names).every((kind) => kind === 'value' || kind === 'type')).toBe(true);
    }
  });
});

/**
 * A small repository: one package whose entry is `entry`, over an implementation with a function, a
 * constant and a type, and a module that passes the function on as a type only.
 */
function fixture(entry) {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-api-root-'));
  const src = join(root, 'packages/demo/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(root, 'packages/demo/package.json'), JSON.stringify({ name: '@fixture/demo' }));
  writeFileSync(
    join(src, 'impl.ts'),
    'export function make(): number {\n  return 1;\n}\nexport const VALUE = 1;\nexport type Shape = { a: number };\n',
  );
  writeFileSync(join(src, 'types-only.ts'), "export type { make as madeType } from './impl';\n");
  writeFileSync(join(src, 'index.ts'), entry);
  return { root, entry: join(src, 'index.ts'), snapshot: join(root, 'api-surface.json') };
}
const kindsOf = (snapshot) => JSON.parse(readFileSync(snapshot, 'utf8')).packages.demo;
const VALUE_ENTRY = "export { make, type Shape, VALUE, VALUE as ALIASED } from './impl';\n";

describe('the kind of a public name is how the entry exports it', () => {
  it('records a value, a type, a value under an alias, and a value passed on as a type only', () => {
    const repo = fixture(`${VALUE_ENTRY}export { madeType } from './types-only';\n`);
    try {
      expect(run('--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      expect(kindsOf(repo.snapshot)).toEqual({
        ALIASED: 'value',
        Shape: 'type',
        VALUE: 'value',
        madeType: 'type',
        make: 'value',
      });
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('fails when a value becomes a type-only export: the name stays, the run-time export is gone', () => {
    const repo = fixture(VALUE_ENTRY);
    try {
      run('--root', repo.root, '--snapshot', repo.snapshot, '--write');
      for (const typeOnly of [
        "export { type make, type Shape, VALUE, VALUE as ALIASED } from './impl';\n",
        "export type { make } from './impl';\nexport { type Shape, VALUE, VALUE as ALIASED } from './impl';\n",
      ]) {
        writeFileSync(repo.entry, typeOnly);
        const check = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
        expect(check.status).toBe(1);
        expect(check.stderr).toContain('  added    demo: type make');
        expect(check.stderr).toContain('  removed  demo: value make');
      }
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('fails when a type-only export becomes a value', () => {
    const repo = fixture("export { type make, type Shape, VALUE, VALUE as ALIASED } from './impl';\n");
    try {
      run('--root', repo.root, '--snapshot', repo.snapshot, '--write');
      expect(kindsOf(repo.snapshot).make).toBe('type');
      writeFileSync(repo.entry, VALUE_ENTRY);
      const check = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('  added    demo: value make');
      expect(check.stderr).toContain('  removed  demo: type make');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('fails when a value re-exported under an alias becomes type-only', () => {
    const repo = fixture(VALUE_ENTRY);
    try {
      run('--root', repo.root, '--snapshot', repo.snapshot, '--write');
      writeFileSync(repo.entry, "export { make, type Shape, VALUE, type VALUE as ALIASED } from './impl';\n");
      const check = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('  added    demo: type ALIASED');
      expect(check.stderr).toContain('  removed  demo: value ALIASED');
      expect(check.stderr).not.toContain('demo: type VALUE');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);
});
