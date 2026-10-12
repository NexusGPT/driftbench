import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./rename-scope.mjs', import.meta.url));

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rename-scope-'));
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
    "import { run } from '@driftbench/core';\nimport type { X } from '@driftbench/cli';\nvi.mock('@driftbench/battery/src/x');\n",
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
  write(root, 'docs/releasing.md', 'Check the `@driftbench/` name.\n');
  write(root, 'docs/usage.md', 'Install `@driftbench/cli` and run `driftbench`.\n');
  write(root, 'node_modules/@driftbench/core/index.js', "export const v = '@driftbench/core';\n");
  write(root, 'packages/core/dist/index.js', "export const v = '@driftbench/core';\n");
  write(root, 'examples/acme/recordings/run.cassette.json', '{"pkg":"@driftbench/core"}\n');
  write(root, 'python/driftbench/pyproject.toml', 'name = "driftbench"\n');
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

  it('skips node_modules, dist, recordings and the python package', () => {
    const root = fixture();
    runCodemod(root);
    const after = tree(root);
    expect(after['node_modules/@driftbench/core/index.js']).toContain('@driftbench/core');
    expect(after['packages/core/dist/index.js']).toContain('@driftbench/core');
    expect(after['examples/acme/recordings/run.cassette.json']).toContain('@driftbench/core');
    expect(after['python/driftbench/pyproject.toml']).toBe('name = "driftbench"\n');
  });
});
