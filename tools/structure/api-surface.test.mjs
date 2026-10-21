// The public API gate: the names every package exports are frozen in tools/structure/api-surface.json.
// A pull request that adds or removes a public name fails here until it regenerates that file
// (node tools/structure/api-surface.mjs --write), which puts the change in front of a reviewer.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const TOOL = fileURLToPath(new URL('./api-surface.mjs', import.meta.url));
const SNAPSHOT = fileURLToPath(new URL('./api-surface.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

describe('public API', () => {
  it('matches the frozen list of exports', () => {
    // CI builds and stamps before tests. A stale checkout must fail, never rebuild under other workers.
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
      expect(check.stderr).toContain('node tools/structure/api-surface.mjs --build --write');
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

/** Built fixtures by entry: a fixture's files depend on its entry alone, so each entry is built once and copied. */
const builtFixtures = new Map();
afterAll(() => {
  for (const template of builtFixtures.values()) rmSync(template, { recursive: true, force: true });
});

/**
 * A small repository: one package whose entry is `entry`, over an implementation with a function, a
 * constant and a type, and a module that passes the function on as a type only.
 */
function fixture(entry) {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-api-root-'));
  const template = builtFixtures.get(entry);
  if (template) {
    cpSync(template, root, { recursive: true });
    return fixtureAt(root);
  }
  const src = join(root, 'packages/demo/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(root, 'packages/demo/package.json'),
    JSON.stringify({
      name: '@fixture/demo',
      type: 'module',
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './other': { types: './dist/other.d.ts', import: './dist/other.js' },
      },
    }),
  );
  writeFileSync(
    join(src, 'impl.ts'),
    'export function make(): number {\n  return 1;\n}\nexport const VALUE = 1;\nexport type Shape = { a: number };\n',
  );
  writeFileSync(join(src, 'types-only.ts'), "export type { make as madeType } from './impl.js';\n");
  writeFileSync(join(src, 'index.ts'), entry);
  writeFileSync(join(src, 'other.ts'), 'export {};\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { build: 'node build.mjs' } }),
  );
  const typescript = createRequire(import.meta.url).resolve('typescript');
  writeFileSync(
    join(root, 'build.mjs'),
    `
    import ts from ${JSON.stringify(typescript)};
    import { readdirSync, rmSync } from 'node:fs';
    rmSync('packages/demo/dist', { recursive: true, force: true });
    const files = ts.sys.readDirectory('packages/demo/src', ['.ts']);
    const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, declaration: true, skipLibCheck: true,
      outDir: 'packages/demo/dist', types: [] });
    const result = program.emit();
    if (result.emitSkipped) process.exit(1);
  `,
  );
  const built = spawnSync(process.execPath, [join(root, 'build.mjs')], { cwd: root, encoding: 'utf8' });
  expect(built.status, built.stderr).toBe(0);
  const copy = mkdtempSync(join(tmpdir(), 'driftbench-api-template-'));
  cpSync(root, copy, { recursive: true });
  builtFixtures.set(entry, copy);
  return fixtureAt(root);
}
const fixtureAt = (root) => ({
  root,
  entry: join(root, 'packages/demo/src/index.ts'),
  snapshot: join(root, 'api-surface.json'),
});
const kindsOf = (snapshot) => JSON.parse(readFileSync(snapshot, 'utf8')).packages.demo;
const VALUE_ENTRY = "export { make, type Shape, VALUE, VALUE as ALIASED } from './impl.js';\n";

describe('the kind of a public name is how the entry exports it', () => {
  it('records a value, a type, a value under an alias, and a value passed on as a type only', () => {
    const repo = fixture(`${VALUE_ENTRY}export { madeType } from './types-only.js';\n`);
    try {
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
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
      run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
      for (const typeOnly of [
        "export { type make, type Shape, VALUE, VALUE as ALIASED } from './impl.js';\n",
        "export type { make } from './impl.js';\nexport { type Shape, VALUE, VALUE as ALIASED } from './impl.js';\n",
      ]) {
        writeFileSync(repo.entry, typeOnly);
        const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
        expect(check.status).toBe(1);
        expect(check.stderr).toContain('  added    demo: type make');
        expect(check.stderr).toContain('  removed  demo: value make');
      }
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('fails when a type-only export becomes a value', () => {
    const repo = fixture("export { type make, type Shape, VALUE, VALUE as ALIASED } from './impl.js';\n");
    try {
      run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
      expect(kindsOf(repo.snapshot).make).toBe('type');
      writeFileSync(repo.entry, VALUE_ENTRY);
      const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
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
      run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
      writeFileSync(
        repo.entry,
        "export { make, type Shape, VALUE, type VALUE as ALIASED } from './impl.js';\n",
      );
      const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('  added    demo: type ALIASED');
      expect(check.stderr).toContain('  removed  demo: value ALIASED');
      expect(check.stderr).not.toContain('demo: type VALUE');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('built runtime exports decide value names', () => {
  it.each([
    [
      'declare const',
      'export const direct = 1;',
      'export declare const direct: number;',
      'removed  demo: value direct',
    ],
    [
      'declare enum',
      'export enum Direct { One }',
      'export declare enum Direct { One }',
      'removed  demo: value Direct',
    ],
    [
      'type-only function',
      "export { make } from './impl.js';",
      "export { type make } from './impl.js';",
      'removed  demo: value make',
    ],
    [
      'added value',
      'export const direct = 1;',
      'export const direct = 1; export const extra = 2;',
      'added    demo: value extra',
    ],
    ['removed value', 'export const direct = 1;', 'export {};', 'removed  demo: value direct'],
  ])(
    'refuses %s after building the changed entry',
    (_name, before, after, diagnostic) => {
      const repo = fixture(before);
      try {
        expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
        writeFileSync(repo.entry, after);
        const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
        expect(check.status, check.stderr).toBe(1);
        expect(check.stderr).toContain(diagnostic);
      } finally {
        rmSync(repo.root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('sees a name moved between entries and a new name on a secondary entry', () => {
    const repo = fixture('export const direct = 1;');
    try {
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      writeFileSync(
        join(repo.root, 'packages/demo/src/other.ts'),
        'export const direct = 1; export const extra = 2;',
      );
      writeFileSync(repo.entry, 'export {};');
      const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('removed  demo: value direct');
      expect(check.stderr).toContain('added    demo/other: value direct');
      expect(check.stderr).toContain('added    demo/other: value extra');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('freezes re-exports and namespace exports from the loaded entry', () => {
    const repo = fixture("export * from './impl.js'; export * as ns from './impl.js';");
    try {
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      expect(kindsOf(repo.snapshot)).toEqual({ Shape: 'type', VALUE: 'value', make: 'value', ns: 'value' });
      expect(JSON.parse(readFileSync(repo.snapshot, 'utf8')).packages['demo/other']).toEqual({});
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects stale source or altered dist without an explicit build', () => {
    const repo = fixture('export const direct = 1;');
    try {
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      writeFileSync(repo.entry, 'export declare const direct: number;');
      const stale = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('stale');
      writeFileSync(repo.entry, 'export const direct = 1;');
      writeFileSync(join(repo.root, 'packages/demo/dist/index.js'), 'export {};');
      const altered = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(altered.status).toBe(1);
      expect(altered.stderr).toContain('stale');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  }, 120_000);
});

it('detects changes to an empty export-map entry too', () => {
  const repo = fixture('export const direct = 1;');
  try {
    expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
    const path = join(repo.root, 'packages/demo/package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    delete manifest.exports['./other'];
    writeFileSync(path, JSON.stringify(manifest));
    const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('removed  demo/other: entry');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
}, 120_000);

it.each(['.hidden', 'coverage/hidden', 'build/hidden'])(
  'includes source module %s in the build stamp',
  (module) => {
    const repo = fixture('export const direct = 1;');
    try {
      const hidden = join(repo.root, 'packages/demo/src', `${module}.ts`);
      mkdirSync(join(hidden, '..'), { recursive: true });
      writeFileSync(hidden, 'export const hidden = 1;');
      writeFileSync(repo.entry, `export { hidden } from './${module}.js';`);
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      writeFileSync(hidden, 'export declare const hidden: number;');
      const check = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('stale');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  },
  120_000,
);

it('reads emitted values even when no source declaration advertises them', () => {
  const repo = fixture('export const direct = 1;');
  try {
    expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
    const build = join(repo.root, 'build.mjs');
    writeFileSync(
      build,
      `${readFileSync(build, 'utf8')}\n(await import('node:fs')).appendFileSync('packages/demo/dist/index.js', '\\nexport const emittedOnly = 1;');`,
    );
    const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('added    demo: value emittedOnly');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
}, 120_000);

it('refuses source and built declaration type-only disagreement', () => {
  const repo = fixture('export type Shape = { a: number };');
  try {
    expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
    const build = join(repo.root, 'build.mjs');
    writeFileSync(
      build,
      `${readFileSync(build, 'utf8')}\n(await import('node:fs')).appendFileSync('packages/demo/dist/index.d.ts', '\\nexport type Phantom = {};');`,
    );
    const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('source and built declaration type-only names differ: Phantom');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
}, 120_000);

const REBUILD =
  'The API build is missing or stale. Run node tools/structure/api-surface.mjs --build --check.\n';

it('hashes the content behind an in-repository source symlink', () => {
  const repo = fixture('export const direct = 1;');
  try {
    const shared = join(repo.root, 'shared.ts');
    writeFileSync(shared, 'export const direct = 1;');
    symlinkSync(shared, join(repo.root, 'packages/demo/src/linked.ts'));
    writeFileSync(repo.entry, "export { direct } from './linked.js';");
    const freeze = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
    expect(freeze.status, freeze.stderr).toBe(0);
    writeFileSync(shared, 'export declare const direct: number;');
    const stale = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(stale.status).toBe(1);
    expect(stale.stderr).toBe(REBUILD);
    const rebuilt = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(rebuilt.status, rebuilt.stderr).toBe(1);
    expect(rebuilt.stderr).not.toContain('stale');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
}, 120_000);

it('follows a re-export from a sibling package source', () => {
  const repo = fixture('export const direct = 1;');
  try {
    const sibling = join(repo.root, 'packages/sibling/src/index.ts');
    mkdirSync(join(sibling, '..'), { recursive: true });
    writeFileSync(sibling, 'export const direct = 1;');
    writeFileSync(repo.entry, "export { direct } from '../../sibling/src/index.js';");
    for (const pkg of ['demo', 'sibling']) {
      writeFileSync(
        join(repo.root, 'packages', pkg, 'package.json'),
        JSON.stringify({
          name: `@fixture/${pkg}`,
          type: 'module',
          exports: {
            '.': {
              source: './src/index.ts',
              types: `./dist/${pkg}/src/index.d.ts`,
              import: `./dist/${pkg}/src/index.js`,
            },
          },
        }),
      );
    }
    const build = join(repo.root, 'build.mjs');
    const original = readFileSync(build, 'utf8');
    writeFileSync(
      build,
      original.replace("outDir: 'packages/demo/dist'", "rootDir: 'packages', outDir: 'packages/demo/dist'") +
        "\n(await import('node:fs')).cpSync('packages/demo/dist', 'packages/sibling/dist', { recursive: true });",
    );
    const freeze = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
    expect(freeze.status, freeze.stderr).toBe(0);
    writeFileSync(sibling, 'export declare const direct: number;');
    const stale = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(stale.status).toBe(1);
    expect(stale.stderr).toBe(REBUILD);
    const rebuilt = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
    expect(rebuilt.status, rebuilt.stderr).toBe(1);
    expect(rebuilt.stderr).not.toContain('stale');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
}, 120_000);

it.each(['malformed', 'missing', 'unreadable', 'wrong shape'])(
  'gives the exact rebuild command for a %s stamp',
  (state) => {
    const repo = fixture('export const direct = 1;');
    try {
      expect(run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write').status).toBe(0);
      const stamp = join(repo.root, '.cache/api-surface-build.json');
      if (state === 'malformed') writeFileSync(stamp, '{');
      if (state === 'wrong shape') writeFileSync(stamp, 'null');
      if (state === 'missing' || state === 'unreadable') rmSync(stamp);
      if (state === 'unreadable') mkdirSync(stamp);
      const stale = run('--root', repo.root, '--snapshot', repo.snapshot, '--check');
      expect(stale.status).toBe(1);
      expect(stale.stderr).toBe(REBUILD);
      if (state !== 'unreadable') {
        const repaired = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--check');
        expect(repaired.status, repaired.stderr).toBe(0);
      }
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  },
  120_000,
);

it('refuses a source symlink that resolves outside the repository', () => {
  const repo = fixture('export const direct = 1;');
  const outside = mkdtempSync(join(tmpdir(), 'driftbench-api-outside-'));
  try {
    const shared = join(outside, 'shared.ts');
    writeFileSync(shared, 'export const direct = 1;');
    symlinkSync(shared, join(repo.root, 'packages/demo/src/linked.ts'));
    writeFileSync(repo.entry, "export { direct } from './linked.js';");
    const check = run('--build', '--root', repo.root, '--snapshot', repo.snapshot, '--write');
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('source resolves outside the repository');
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}, 120_000);
