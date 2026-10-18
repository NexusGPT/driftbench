// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold literal JavaScript source.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./rename-scope.mjs', import.meta.url));
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rename-scope-'));
  roots.push(root);
  write(
    root,
    'packages/battery/package.json',
    JSON.stringify({ name: '@driftbench/battery', private: true }),
  );
  write(
    root,
    'packages/cli/package.json',
    JSON.stringify(
      {
        name: '@driftbench/cli',
        bin: { driftbench: './dist/bin.js' },
        dependencies: { '@driftbench/core': 'workspace:*' },
      },
      null,
      2,
    ),
  );
  write(
    root,
    'packages/core/package.json',
    JSON.stringify(
      { name: '@driftbench/core', devDependencies: { '@driftbench/battery': 'workspace:*' } },
      null,
      2,
    ),
  );
  write(
    root,
    'packages/core/src/run.ts',
    "import { run } from '@driftbench/core';\nimport type { X } from '@driftbench/cli';\nvi.mock('@driftbench/battery/src/x');\nconst x = require('@driftbench/checks');\nexport * from '@driftbench/users';\nconst y = import('@driftbench/cli/subpath');\n",
  );
  write(root, 'packages/core/test/run.test.ts', "const name = '@driftbench/judges';\n");
  write(
    root,
    'tsconfig.base.json',
    '{\n  "paths": {\n    "@driftbench/*": ["./packages/*/src/index.ts"]\n  }\n}\n',
  );
  write(
    root,
    'vitest.config.ts',
    "const packages = ['cli', 'core'];\nexport const alias = packages.map((name) => [\n  `@driftbench/${name}`,\n]);\n",
  );
  write(
    root,
    'tools/release/check.mjs',
    "const SCOPE = '@driftbench/';\nconst x = short === 'cli' ? `${SCOPE}cli` : `${SCOPE}${short}`;\n",
  );
  write(
    root,
    'docs/releasing.md',
    'Packages under the `@driftbench` scope. Check the `@driftbench/` name.\n',
  );
  write(root, 'docs/usage.md', 'Install `@driftbench/cli` and run `driftbench`.\n');
  write(root, 'CHANGELOG.md', '- `@driftbench/cli` and `@driftbench/core` ship together.\n');
  write(root, '.github/workflows/ci.yml', 'run: pnpm test\n# npm install @driftbench/cli\n');
  write(root, '.github/workflows/release.yml', 'run: pnpm test\n# npm publish @driftbench/core\n');
  write(root, '.git/config.json', '{"pkg":"@driftbench/core"}\n');
  write(root, 'node_modules/@driftbench/core/index.js', "export const v = '@driftbench/core';\n");
  write(root, 'packages/core/dist/index.js', "export const v = '@driftbench/core';\n");
  write(root, 'examples/acme/recordings/run.cassette.json', '{"pkg":"@driftbench/core"}\n');
  write(root, 'packages/core/test/saved.cassette.json', '{"pkg":"@driftbench/core"}\n');
  for (const rel of [
    'examples/estates/fixture',
    'examples/estates/fixture-v2',
    'examples/estates/reader-cases',
    'packages/validators/fixtures/estate',
    'packages/validators/fixtures/map',
  ])
    write(root, `${rel}/hashed.md`, 'A frozen @driftbench/core input.\n');
  write(root, 'python/driftbench/pyproject.toml', 'name = "driftbench"\n');
  write(root, 'python/driftbench/README.md', 'Install @driftbench/cli.\n');
  return root;
}

function tree(root) {
  const out = {};
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else out[full.slice(root.length + 1)] = readFileSync(full, 'utf8');
    }
  };
  visit(root);
  return out;
}

function runCodemod(root) {
  return execFileSync('node', [SCRIPT, root], { encoding: 'utf8' });
}

describe('rename-scope codemod', () => {
  it('preserves hashed benchmark data and recordings while renaming the harness imports', () => {
    const root = fixture();
    const files = [
      'benchmarks/slices/fictional/1/source.json',
      'benchmarks/cassettes/fictional@1/haiku.json',
      'benchmarks/evidence/fictional@1/haiku.json',
      '.bench-run/previous.json',
    ];
    for (const file of files) write(root, file, '{"quote":"@driftbench/core"}\n');
    write(root, 'benchmarks/run.ts', "import { playerClient } from '@driftbench/judges';\n");
    const before = tree(root);
    runCodemod(root);
    const after = tree(root);
    for (const file of files) expect(after[file]).toBe(before[file]);
    expect(after['benchmarks/run.ts']).toContain('@agent-nexus/driftbench-judges');
  });
  it('preserves pinned comparison snapshots and their legacy cache wrapper', () => {
    const root = fixture();
    const files = [
      'comparisons/inspect/hard/archive-env.ts',
      'comparisons/inspect/hard/arch-deciding-snapshot.json',
      'comparisons/inspect/hard/arch-snapshot.json',
      'comparisons/inspect/hard/deciding/main-snapshot.json',
      'comparisons/langwatch/hard/pr115.mts',
      'comparisons/langwatch/hard/pr115-verification.md',
    ];
    for (const rel of files)
      write(
        root,
        rel,
        rel.endsWith('.ts') || rel.endsWith('.mts')
          ? 'const folder = `node_modules/@driftbench/${name}/`;\n'
          : JSON.stringify({ pinnedSource: "import core from '@driftbench/core'" }),
      );
    const before = tree(root);
    expect(() => runCodemod(root)).not.toThrow();
    const after = tree(root);
    for (const rel of files) expect(after[rel], rel).toBe(before[rel]);
    expect(after['packages/core/src/run.ts']).toContain('@agent-nexus/driftbench-core');
  });

  it('maps the cli to the bare scope and every other package to a suffixed name', () => {
    const root = fixture();
    runCodemod(root);
    const cli = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
    expect(cli.name).toBe('@agent-nexus/driftbench');
    expect(cli.dependencies).toEqual({ '@agent-nexus/driftbench-core': 'workspace:*' });
    const src = readFileSync(join(root, 'packages/core/src/run.ts'), 'utf8');
    expect(src).toContain("from '@agent-nexus/driftbench-core'");
    expect(src).toContain("from '@agent-nexus/driftbench'");
    expect(src).toContain("vi.mock('@agent-nexus/driftbench-battery/src/x')");
    expect(src).toContain("require('@agent-nexus/driftbench-checks')");
    expect(src).toContain("export * from '@agent-nexus/driftbench-users'");
    expect(src).toContain("import('@agent-nexus/driftbench/subpath')");
    expect(JSON.parse(readFileSync(join(root, 'packages/battery/package.json'), 'utf8'))).toEqual({
      name: '@agent-nexus/driftbench-battery',
      private: true,
    });
  });

  it('keeps the driftbench bin name', () => {
    const root = fixture();
    runCodemod(root);
    const cli = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
    expect(cli.bin).toEqual({ driftbench: './dist/bin.js' });
  });

  it('rewrites the dynamic and wildcard forms', () => {
    const root = fixture();
    runCodemod(root);
    expect(readFileSync(join(root, 'tsconfig.base.json'), 'utf8')).toContain(
      '"@agent-nexus/driftbench-*": ["./packages/*/src/index.ts"]',
    );
    expect(readFileSync(join(root, 'vitest.config.ts'), 'utf8')).toContain(
      "name === 'cli' ? '@agent-nexus/driftbench' : `@agent-nexus/driftbench-${name}`,",
    );
    expect(readFileSync(join(root, 'tools/release/check.mjs'), 'utf8')).toContain(
      "const SCOPE = '@agent-nexus/driftbench';",
    );
  });

  it('is idempotent: a second run changes no file', () => {
    const root = fixture();
    runCodemod(root);
    const once = tree(root);
    const second = runCodemod(root);
    expect(second).toContain('0 file(s) changed');
    expect(tree(root)).toEqual(once);
  });

  it('rewrites docs, changelog package lines and workflows', () => {
    const root = fixture();
    runCodemod(root);
    const after = tree(root);
    expect(after['docs/releasing.md']).toContain('under the `@agent-nexus` scope');
    expect(after['docs/usage.md']).toContain('Install `@agent-nexus/driftbench` and run `driftbench`');
    expect(after['CHANGELOG.md']).toContain('`@agent-nexus/driftbench` and `@agent-nexus/driftbench-core`');
    expect(after['.github/workflows/ci.yml']).toContain('run: pnpm test --maxWorkers=2');
    expect(after['.github/workflows/ci.yml']).toContain('npm install @agent-nexus/driftbench');
    expect(after['.github/workflows/release.yml']).toContain('npm publish @agent-nexus/driftbench-core');
  });

  it('skips dependencies, builds, git, recordings, frozen fixtures and the python package', () => {
    const root = fixture();
    const before = tree(root);
    runCodemod(root);
    const after = tree(root);
    for (const [rel, content] of Object.entries(before)) {
      if (
        rel.startsWith('node_modules/') ||
        rel.includes('/dist/') ||
        rel.startsWith('.git/') ||
        rel.includes('/recordings/') ||
        rel.endsWith('.cassette.json') ||
        rel.endsWith('/hashed.md') ||
        rel.startsWith('python/')
      )
        expect(after[rel], rel).toBe(content);
    }
  });
});
