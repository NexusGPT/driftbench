#!/usr/bin/env node
// Release check: every publishable package carries a complete manifest, one version runs through the
// packages, the Python project and the changelog, and `npm pack` holds only the build. Publishes nothing.
//
//   node tools/release/check.mjs                 check the tree (packages must be built first)
//   node tools/release/check.mjs --expect v0.1.0 also require that version, for example the pushed tag
//   node tools/release/check.mjs --no-pack       skip the pack listing
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = '@agent-nexus/driftbench';
const LICENSE = 'MIT';
const REPO_URL = 'git+https://github.com/achammah/driftbench.git';

const JUNK = [
  [/(^|\/)(test|tests|__tests__|fixtures?)\//, 'test or fixture folder'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)src\//, 'source folder'],
  [/(?<!\.d)\.[cm]?tsx?$/, 'TypeScript source'],
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/(^|\/)\.DS_Store$/, 'system file'],
  [/\.tsbuildinfo$/, 'build cache'],
  [/(^|\/)node_modules\//, 'node_modules'],
];

/** Files from a pack listing that should not ship. */
export function junkFiles(files) {
  return files.filter((file) => JUNK.some(([pattern]) => pattern.test(file)));
}

function isEmpty(value) {
  return (
    value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === ''
  );
}

/** Problems with one publishable manifest; `dir` is its path from the repository root. */
export function checkManifest(dir, manifest, { readme }) {
  const problems = [];
  const where = `${dir}/package.json`;
  const short = dir.split('/').pop();
  const expectedName = short === 'cli' ? SCOPE : `${SCOPE}-${short}`;
  if (manifest.name !== expectedName)
    problems.push(`${where}: name is ${manifest.name}, expected ${expectedName}`);
  if (manifest.private) problems.push(`${where}: private is set, so it cannot be published`);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version ?? ''))
    problems.push(`${where}: version is not semver`);
  if (isEmpty(manifest.description)) problems.push(`${where}: description is missing`);
  if (manifest.license !== LICENSE)
    problems.push(`${where}: license is ${manifest.license}, expected ${LICENSE}`);
  if (isEmpty(manifest.keywords)) problems.push(`${where}: keywords are missing`);
  if (manifest.type !== 'module') problems.push(`${where}: type should be module`);
  if (isEmpty(manifest.engines?.node)) problems.push(`${where}: engines.node is missing`);
  if (isEmpty(manifest.types)) problems.push(`${where}: types is missing`);
  if (isEmpty(manifest.main)) problems.push(`${where}: main is missing`);
  if (isEmpty(manifest.files))
    problems.push(`${where}: files is missing, so npm would pack the whole folder`);
  const repository = manifest.repository ?? {};
  if (repository.url !== REPO_URL) problems.push(`${where}: repository.url should be ${REPO_URL}`);
  if (repository.directory !== dir) problems.push(`${where}: repository.directory should be ${dir}`);
  if (isEmpty(manifest.homepage)) problems.push(`${where}: homepage is missing`);
  if (isEmpty(manifest.bugs?.url)) problems.push(`${where}: bugs.url is missing`);
  if (manifest.publishConfig?.access !== 'public')
    problems.push(`${where}: publishConfig.access should be public`);
  const exportsMap = manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object') {
    problems.push(`${where}: exports is missing`);
  } else {
    for (const [key, target] of Object.entries(exportsMap)) {
      if (typeof target !== 'object' || !target.types || !target.import) {
        problems.push(`${where}: exports["${key}"] needs a types and an import condition`);
      }
    }
  }
  if (short === 'cli' && !manifest.bin?.driftbench)
    problems.push(`${where}: bin.driftbench is missing on the cli`);
  if (!readme) problems.push(`${dir}/README.md is missing`);
  return problems;
}

/** One version across the packages and the Python project; internal dependencies stay on workspace:. */
export function checkVersions(packages, { python, expected } = {}) {
  const problems = [];
  const version = expected ?? packages[0]?.manifest.version;
  for (const { manifest } of packages) {
    if (manifest.version !== version)
      problems.push(`${manifest.name} is at ${manifest.version}, expected ${version}`);
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith(SCOPE) && !String(range).startsWith('workspace:')) {
          problems.push(
            `${manifest.name} pins ${name}@${range}; use workspace:* so the publish writes the release version`,
          );
        }
      }
    }
  }
  if (python !== undefined && python !== version)
    problems.push(`python/driftbench is at ${python}, expected ${version}`);
  return { version, problems };
}

/** The changelog needs a heading for the version, as "## [x.y.z]" or "## x.y.z". */
export function checkChangelog(text, version) {
  const escaped = version.replaceAll('.', '\\.');
  const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`, 'm');
  return heading.test(text) ? [] : [`CHANGELOG.md has no "## [${version}]" heading`];
}

/** What `npm pack` would put in the tarball, with its sizes in bytes. Writes nothing. */
export function packFiles(dir) {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  const [entry] = JSON.parse(raw);
  return {
    files: entry.files.map((file) => file.path),
    size: entry.size,
    unpackedSize: entry.unpackedSize,
  };
}

function pythonVersion(root) {
  const path = join(root, 'python', 'driftbench', 'pyproject.toml');
  if (!existsSync(path)) return undefined;
  const project = readFileSync(path, 'utf8')
    .split(/^\[/m)
    .find((section) => section.startsWith('project]'));
  return project?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? 'missing';
}

function readPackages(root) {
  const base = join(root, 'packages');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'package.json')))
    .map((entry) => ({
      dir: `packages/${entry.name}`,
      path: join(base, entry.name),
      manifest: JSON.parse(readFileSync(join(base, entry.name, 'package.json'), 'utf8')),
    }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export function main(argv, io) {
  const cwd = io.cwd ?? process.cwd();
  let expected;
  let pack = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--expect') expected = String(argv[++i] ?? '').replace(/^v/, '');
    else if (argv[i] === '--no-pack') pack = false;
    else {
      io.err(`unknown option ${argv[i]}\n`);
      return 2;
    }
  }
  const all = readPackages(cwd);
  const publishable = all.filter((pkg) => !pkg.manifest.private);
  const skipped = all.filter((pkg) => pkg.manifest.private).map((pkg) => pkg.manifest.name);
  const problems = [];
  if (publishable.length === 0) problems.push('no publishable package under packages/');
  for (const pkg of publishable) {
    problems.push(
      ...checkManifest(pkg.dir, pkg.manifest, { readme: existsSync(join(pkg.path, 'README.md')) }),
    );
  }
  const python = pythonVersion(cwd);
  const versions = checkVersions(publishable, { python, expected });
  problems.push(...versions.problems);
  const changelogPath = join(cwd, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) problems.push('CHANGELOG.md is missing');
  else if (versions.version)
    problems.push(...checkChangelog(readFileSync(changelogPath, 'utf8'), versions.version));

  const rows = [];
  if (pack) {
    for (const pkg of publishable) {
      if (!existsSync(join(pkg.path, 'dist'))) {
        problems.push(`${pkg.manifest.name}: dist is missing; run pnpm build first`);
        continue;
      }
      const result = packFiles(pkg.path);
      for (const file of junkFiles(result.files)) problems.push(`${pkg.manifest.name} would pack ${file}`);
      rows.push(
        `${pkg.manifest.name.padEnd(24)} ${String(result.files.length).padStart(4)} files  ${kb(result.size).padStart(10)} packed  ${kb(result.unpackedSize).padStart(10)} unpacked`,
      );
    }
  }

  io.out(
    `driftbench release check: version ${versions.version ?? 'unknown'}, ${publishable.length} packages`,
  );
  io.out(python === undefined ? ', no Python project\n' : `, python/driftbench ${python}\n`);
  if (skipped.length > 0) io.out(`private, not published: ${skipped.join(', ')}\n`);
  for (const row of rows) io.out(`${row}\n`);
  if (problems.length > 0) {
    io.err(
      `${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map((p) => `  ${p}\n`).join('')}`,
    );
    return 1;
  }
  io.out('clean\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
