#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the codemod matches literal JavaScript source.
// Renames the npm scope of driftbench's packages: @driftbench/cli becomes @agent-nexus/driftbench,
// and every other @driftbench/<name> becomes @agent-nexus/driftbench-<name>.
//
// Run it from the repository root (or pass a root directory): node tools/rename-scope.mjs [root]
// A second run changes nothing. The `driftbench` bin name, the GitHub repository URL and the
// Python package are not touched. Run `pnpm install` afterwards to refresh the lockfile.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const NEW_SCOPE = '@agent-nexus/driftbench';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  '.pnpm-store',
  '.cache',
  'recordings',
  '_captures',
]);
// These trees pin hashes or exact scan output. They are inputs and saved evidence, not npm source.
const SKIP_PATHS = new Set([
  '.bench-run',
  'benchmarks/slices',
  'benchmarks/cassettes',
  'benchmarks/evidence',
  'python',
  'examples/estates/fixture',
  'examples/estates/fixture-v2',
  'examples/estates/reader-cases',
  'packages/validators/fixtures/estate',
  'packages/validators/fixtures/map',
]);
// The codemod and its test name the old scope in their own source, so they are never edited.
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'rename-scope.mjs', 'rename-scope.test.mjs']);
// Historical comparison evidence pins source bytes; its cache wrapper intentionally resolves old names.
const PINNED_COMPARISON_FILES = new Set([
  'comparisons/inspect/hard/archive-env.ts',
  'comparisons/inspect/hard/arch-deciding-snapshot.json',
  'comparisons/inspect/hard/arch-snapshot.json',
  'comparisons/inspect/hard/deciding/main-snapshot.json',
  'comparisons/langwatch/hard/pr115.mts',
  'comparisons/langwatch/hard/pr115-verification.md',
]);
const SKIP_FILE_PATTERN = /\.cassette\.json$/;
const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.mjs',
  '.js',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.py',
]);

// Shapes a plain regex cannot reach: dynamic names, wildcard path aliases and one prose phrase.
// Each entry is [file relative to the root, text before, text after]. Once rewritten, a pair no
// longer matches, so the table is idempotent.
const LITERAL_RULES = [
  [
    'tsconfig.base.json',
    '"@driftbench/*": ["./packages/*/src/index.ts"]',
    '"@agent-nexus/driftbench": ["./packages/cli/src/index.ts"],\n      "@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]',
  ],
  [
    'vitest.config.ts',
    '`@driftbench/${name}`,',
    "name === 'cli' ? '@agent-nexus/driftbench' : `@agent-nexus/driftbench-${name}`,",
  ],
  ['tools/release/check.mjs', "const SCOPE = '@driftbench/';", "const SCOPE = '@agent-nexus/driftbench';"],
  [
    'tools/release/check.mjs',
    "short === 'cli' ? `${SCOPE}cli` : `${SCOPE}${short}`",
    "short === 'cli' ? SCOPE : `${SCOPE}-${short}`",
  ],
  [
    'tools/release/check.test.mjs',
    '`@driftbench/${dir}`,',
    "dir === 'cli' ? '@agent-nexus/driftbench' : `@agent-nexus/driftbench-${dir}`,",
  ],
  [
    'docs/releasing.md',
    'the `@driftbench/` name',
    'the scoped name (`@agent-nexus/driftbench` for the cli, `@agent-nexus/driftbench-<name>` for the rest)',
  ],
  ['docs/releasing.md', 'under the `@driftbench` scope', 'under the `@agent-nexus` scope'],
  ['.github/workflows/ci.yml', 'run: pnpm test\n', 'run: pnpm test --maxWorkers=2\n'],
  ['.github/workflows/release.yml', 'run: pnpm test\n', 'run: pnpm test --maxWorkers=2\n'],
];

const SCOPED_NAME = /@driftbench\/([a-z0-9][a-z0-9-]*)/g;

function newName(name) {
  return name === 'cli' ? NEW_SCOPE : `${NEW_SCOPE}-${name}`;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = relative(ROOT, full).split(sep).join('/');
      if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(rel)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const changed = [];
const leftover = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (SKIP_FILES.has(basename(file)) || PINNED_COMPARISON_FILES.has(rel) || SKIP_FILE_PATTERN.test(file))
    continue;
  if (!EXTENSIONS.has(extname(file))) continue;

  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [target, from, to] of LITERAL_RULES) {
    if (rel === target) after = after.replaceAll(from, to);
  }
  after = after.replace(SCOPED_NAME, (_match, name) => newName(name));

  if (after !== before) {
    writeFileSync(file, after);
    changed.push(rel);
  }
  if (after.includes('@driftbench/')) leftover.push(rel);
}

for (const rel of changed) console.log(`renamed ${rel}`);
console.log(`${changed.length} file(s) changed`);
if (leftover.length > 0) {
  console.error(`still naming @driftbench/ in: ${leftover.join(', ')}`);
  process.exitCode = 1;
}
