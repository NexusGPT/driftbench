// The build, its input/output stamp, and the actual exported names are one gate.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

function filesUnder(dir, skip = new Set()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name) || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, skip) : [path];
  });
}
function digest(root, files) {
  const hash = createHash('sha256');
  for (const file of files.sort())
    hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}

/** Every current export-map entry, with an explicit refusal for unsupported shapes instead of omission. */
export function packageEntries(root) {
  return readdirSync(join(root, 'packages'))
    .sort()
    .flatMap((pkg) => {
      const dir = join(root, 'packages', pkg);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const map = manifest.exports;
      if (!map || typeof map !== 'object' || Array.isArray(map))
        throw new Error(`${pkg}: an explicit exports map is required`);
      return Object.entries(map).map(([subpath, entry]) => {
        if (
          !subpath.startsWith('.') ||
          subpath.includes('*') ||
          !entry ||
          typeof entry !== 'object' ||
          Object.keys(entry).some((key) => !['types', 'import', 'source'].includes(key)) ||
          typeof entry.import !== 'string' ||
          typeof entry.types !== 'string'
        ) {
          throw new Error(
            `${pkg}${subpath}: unsupported export conditions; extend the runtime probe before freezing this entry`,
          );
        }
        const source =
          entry.source ?? entry.types.replace(/^\.\/dist\//, './src/').replace(/\.d\.ts$/, '.ts');
        const result = {
          pkg,
          name: manifest.name,
          key: subpath === '.' ? pkg : `${pkg}${subpath.slice(1)}`,
          specifier: subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
          source: resolve(dir, source),
          runtime: resolve(dir, entry.import),
          types: resolve(dir, entry.types),
        };
        if (!existsSync(result.source))
          throw new Error(`${result.key}: no source entry ${source}; add an exports.source mapping`);
        return result;
      });
    });
}

export function requireFreshBuild(root, entries, allowBuild) {
  const stampFile = join(root, '.cache/api-surface-build.json');
  const excluded = new Set(['node_modules', 'dist', 'build', 'coverage']);
  const inputs = () =>
    digest(root, [
      ...filesUnder(join(root, 'packages'), excluded),
      ...filesUnder(join(root, 'examples'), excluded),
      ...readdirSync(root)
        .filter((name) =>
          /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*\.json|.*build.*\.[cm]?js)$/.test(
            name,
          ),
        )
        .map((name) => join(root, name)),
      fileURLToPath(import.meta.url),
    ]);
  const outputs = () =>
    digest(
      root,
      [...new Set(entries.map((entry) => entry.pkg))].flatMap((pkg) =>
        filesUnder(join(root, 'packages', pkg, 'dist')),
      ),
    );
  const before = inputs();
  let stamp;
  if (existsSync(stampFile)) stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
  if (stamp?.inputs === before && stamp?.outputs === outputs() && stamp?.node === process.version) return;
  if (!allowBuild)
    throw new Error(
      'The API build is missing or stale. Run node tools/structure/api-surface.mjs --build --check (or --build --write).',
    );
  const build = spawnSync('pnpm', ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, npm_config_workspace_concurrency: '1' },
    timeout: 600_000,
  });
  if (build.status !== 0)
    throw new Error(`API build failed:\n${build.error ?? ''}\n${build.stdout}\n${build.stderr}`);
  if (before !== inputs())
    throw new Error('Build inputs changed while building; retry on a stable source tree.');
  for (const entry of entries) {
    if (!existsSync(entry.runtime) || !existsSync(entry.types))
      throw new Error(`${entry.key}: build did not emit its export entry`);
  }
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, JSON.stringify({ inputs: before, outputs: outputs(), node: process.version }));
}

/** No source predicate decides whether JavaScript exports a value. Each entry gets a fresh Node process. */
export function runtimeNames(entry) {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { writeFileSync } from 'node:fs';
    const entry = await import(${JSON.stringify(pathToFileURL(entry.runtime).href)});
    writeFileSync(3, JSON.stringify(Object.keys(entry).sort()));
  `,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'pipe'], timeout: 30_000 },
  );
  if (probe.status !== 0)
    throw new Error(`${entry.key}: cannot load built entry:\n${probe.error ?? ''}\n${probe.stderr}`);
  return new Set(JSON.parse(probe.output[3]));
}

/** Names visible to a declaration consumer; subtracting runtime names leaves the type-only surface. */
export function declarationNames(entries) {
  const program = ts.createProgram(
    entries.map((entry) => entry.types),
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
  );
  const checker = program.getTypeChecker();
  return new Map(
    entries.map((entry) => {
      const file = program.getSourceFile(entry.types);
      const symbol = file && checker.getSymbolAtLocation(file);
      if (!symbol) throw new Error(`${entry.key}: built declaration entry is not a module`);
      return [entry.key, new Set(checker.getExportsOfModule(symbol).map((item) => item.name))];
    }),
  );
}
