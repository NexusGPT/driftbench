// Guards the package layout. It reads every TypeScript file under packages/*/src and packages/*/test
// as text, extracts the import specifiers, and fails when a package boundary is crossed in a new way.
//
// Each known exception is one literal allowlist entry with its reason. An entry that no longer matches
// anything also fails, so the lists below can only shrink.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCOPE = '@agent-nexus/driftbench';

// Relative imports in src that leave their own package. Key: "<file> -> <specifier>".
const CROSSING_ALLOWLIST = {
  'packages/adapters/src/contract.ts -> ../../../examples/acme/src/index':
    'the contract suite ships the reference agent it holds adapters to, bundled into the contract entry only',
  'packages/validators/src/ladders/system/bank/cli.ts -> ../../../../../cli/src/main':
    'the system ladder drives the real CLI entry; the cli package depends on validators, so a manifest dependency would be a cycle',
  'packages/validators/src/ladders/system/bank/claims/breaker.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry',
  'packages/validators/src/ladders/system/bank/claims/breaker2.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry (two dynamic imports, one specifier)',
  'packages/validators/src/ladders/system/bank/claims/breaker2.ts -> ../../../../../../cli/src/view/server':
    'the viewer write-protection claim starts the real viewer server directly: one in-process start per case instead of a full CLI run (about 5 s each, over 80 starts); the cli package depends on validators, so a manifest dependency would be a cycle',
  'packages/validators/src/ladders/system/bank/claims/cli.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry',
  'packages/validators/src/ladders/system/bank/claims/exits.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry',
  'packages/validators/src/ladders/system/bank/claims/report.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry',
  'packages/validators/src/ladders/system/bank/claims/robust.ts -> ../../../../../../cli/src/main':
    'same as bank/cli.ts: the claim runs the real CLI entry',
};

// Workspace packages imported from src that the manifest does not declare. Key: "<package> -> <package>".
const UNDECLARED_ALLOWLIST = {
  'validators -> report': 'validators imports the report package without listing it in its manifest',
};

// Workspace packages a manifest declares that src never imports. Key: "<package> -> <package>".
const UNUSED_ALLOWLIST = {};

const IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|mts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const posix = (path) => path.split(sep).join('/');

function scan() {
  const dirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
  const manifests = {};
  const dirOfName = {};
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
    manifests[dir] = manifest;
    dirOfName[manifest.name] = dir;
  }
  // One row per import statement: where it is, what it names, and what it resolves to.
  const imports = [];
  for (const dir of dirs) {
    for (const kind of ['src', 'test']) {
      for (const file of walk(join(ROOT, 'packages', dir, kind))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(IMPORT)) {
          const specifier = match[1] ?? match[2];
          const line = text.slice(0, match.index + match[0].lastIndexOf(specifier)).split('\n').length;
          const row = { pkg: dir, kind, file: posix(relative(ROOT, file)), line, specifier };
          if (specifier.startsWith('.')) {
            const target = relative(join(ROOT, 'packages', dir), resolve(dirname(file), specifier));
            row.leavesPackage = target.startsWith('..');
          } else if (
            specifier === SCOPE ||
            specifier.startsWith(`${SCOPE}-`) ||
            specifier.startsWith(`${SCOPE}/`)
          ) {
            const name = specifier.split('/').slice(0, 2).join('/');
            if (dirOfName[name]) {
              row.workspace = dirOfName[name];
              row.deep = specifier !== name;
            }
          }
          imports.push(row);
        }
      }
    }
  }
  return { dirs, manifests, dirOfName, imports };
}

const { dirs, manifests, dirOfName, imports } = scan();
const at = (row) => `${row.file}:${row.line} imports '${row.specifier}'`;

// Compares what was found with an allowlist: anything found and not listed is new,
// anything listed and not found is stale.
function compare(found, allowlist) {
  const keys = new Set(found.keys());
  return {
    unexpected: [...keys].filter((key) => !(key in allowlist)).flatMap((key) => found.get(key)),
    stale: Object.keys(allowlist).filter((key) => !keys.has(key)),
  };
}

function srcEdges() {
  const edges = new Map(dirs.map((dir) => [dir, new Map()]));
  for (const row of imports) {
    if (row.kind !== 'src' || !row.workspace || row.workspace === row.pkg) continue;
    const list = edges.get(row.pkg).get(row.workspace) ?? [];
    list.push(at(row));
    edges.get(row.pkg).set(row.workspace, list);
  }
  return edges;
}

describe('package boundaries', () => {
  it('finds the packages and their imports', () => {
    expect(dirs.length).toBeGreaterThan(10);
    expect(imports.length).toBeGreaterThan(1000);
  });

  it('has no cycle between packages in src imports', () => {
    const edges = srcEdges();
    const cycles = [];
    const state = new Map();
    const visit = (node, trail) => {
      state.set(node, 'open');
      for (const next of edges.get(node).keys()) {
        if (state.get(next) === 'open') {
          cycles.push([...trail.slice(trail.indexOf(next)), next].join(' -> '));
        } else if (!state.has(next)) visit(next, [...trail, next]);
      }
      state.set(node, 'done');
    };
    for (const dir of dirs) if (!state.has(dir)) visit(dir, [dir]);
    expect(cycles, 'a package may not import, through any chain, a package that imports it').toEqual([]);
  });

  it('has no relative import in src that leaves its own package, beyond the allowlist', () => {
    const found = new Map();
    for (const row of imports) {
      if (row.kind !== 'src' || !row.leavesPackage) continue;
      const key = `${row.file} -> ${row.specifier}`;
      found.set(key, [...(found.get(key) ?? []), at(row)]);
    }
    const { unexpected, stale } = compare(found, CROSSING_ALLOWLIST);
    expect(unexpected, 'import the other package by its name, or move the code into this package').toEqual(
      [],
    );
    expect(stale, 'this crossing is gone: delete its entry from CROSSING_ALLOWLIST').toEqual([]);
  });

  it('has no deep import into another workspace package', () => {
    const deep = imports.filter((row) => row.deep).map(at);
    expect(
      deep,
      'import from the package root; add the name to its index if it is meant to be public',
    ).toEqual([]);
  });

  it('declares every workspace package that src imports, beyond the allowlist', () => {
    const found = new Map();
    for (const [dir, targets] of srcEdges()) {
      const declared = { ...manifests[dir].dependencies, ...manifests[dir].peerDependencies };
      for (const [target, places] of targets) {
        if (!(manifests[target].name in declared)) found.set(`${dir} -> ${target}`, places);
      }
    }
    const { unexpected, stale } = compare(found, UNDECLARED_ALLOWLIST);
    expect(unexpected, 'add the package to dependencies in the importing package.json').toEqual([]);
    expect(stale, 'this import is now declared or gone: delete its entry from UNDECLARED_ALLOWLIST').toEqual(
      [],
    );
  });

  it('imports every workspace package its manifest depends on, beyond the allowlist', () => {
    const edges = srcEdges();
    const found = new Map();
    for (const dir of dirs) {
      for (const name of Object.keys(manifests[dir].dependencies ?? {})) {
        const target = dirOfName[name];
        if (target && !edges.get(dir).has(target)) {
          found.set(`${dir} -> ${target}`, [
            `packages/${dir}/package.json lists ${name}; src never imports it`,
          ]);
        }
      }
    }
    const { unexpected, stale } = compare(found, UNUSED_ALLOWLIST);
    expect(unexpected, 'remove the dependency from the manifest, or import it').toEqual([]);
    expect(stale, 'this dependency is now used or gone: delete its entry from UNUSED_ALLOWLIST').toEqual([]);
  });
});
