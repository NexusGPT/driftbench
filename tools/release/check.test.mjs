import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempFolderSync } from '../test-setup/temp-folders.ts';
import { checkChangelog, checkManifest, checkVersions, junkFiles, main, packFiles } from './check.mjs';

const REPO = 'git+https://github.com/achammah/driftbench.git';

function manifest(dir, overrides = {}) {
  return {
    name: dir === 'cli' ? '@agent-nexus/driftbench' : `@agent-nexus/driftbench-${dir}`,
    version: '0.1.0',
    description: 'A fictional package.',
    type: 'module',
    license: 'MIT',
    keywords: ['evaluation'],
    repository: { type: 'git', url: REPO, directory: `packages/${dir}` },
    homepage: 'https://github.com/achammah/driftbench#readme',
    bugs: { url: 'https://github.com/achammah/driftbench/issues' },
    engines: { node: '>=22' },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    files: ['dist'],
    publishConfig: { access: 'public', provenance: true },
    ...overrides,
  };
}

function repo({ packages, changelog = '# Changelog\n\n## [0.1.0] - 2026-10-12\n', pyproject }) {
  const root = tempFolderSync('driftbench-release-test-');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  for (const [dir, pkg] of Object.entries(packages)) {
    const path = join(root, 'packages', dir);
    mkdirSync(join(path, 'dist'), { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(path, 'README.md'), `# ${pkg.name}\n`);
    writeFileSync(join(path, 'dist', 'index.js'), 'export const a = 1;\n');
    writeFileSync(join(path, 'dist', 'index.d.ts'), 'export declare const a: number;\n');
  }
  if (pyproject) {
    mkdirSync(join(root, 'python', 'driftbench'), { recursive: true });
    writeFileSync(join(root, 'python', 'driftbench', 'pyproject.toml'), pyproject);
  }
  return root;
}

function run(argv, cwd) {
  let out = '';
  let err = '';
  const code = main(argv, { out: (t) => (out += t), err: (t) => (err += t), cwd });
  return { code, out, err };
}

describe('checkManifest', () => {
  it('accepts a complete manifest', () => {
    expect(checkManifest('packages/core', manifest('core'), { readme: true })).toEqual([]);
  });

  it('names every missing or wrong field', () => {
    const bad = manifest('core', {
      name: 'core',
      private: true,
      license: 'Apache-2.0',
      keywords: [],
      engines: undefined,
      types: undefined,
      files: undefined,
      repository: { type: 'git', url: REPO, directory: 'packages/other' },
      publishConfig: undefined,
    });
    const problems = checkManifest('packages/core', bad, { readme: false }).join('\n');
    for (const word of [
      'name',
      'private',
      'license',
      'keywords',
      'engines',
      'types',
      'files',
      'repository.directory',
      'publishConfig',
      'README.md',
    ]) {
      expect(problems).toContain(word);
    }
  });

  it('requires the driftbench bin on the cli', () => {
    expect(checkManifest('packages/cli', manifest('cli'), { readme: true }).join('\n')).toContain('bin');
    const cli = manifest('cli', { bin: { driftbench: './dist/bin.js' } });
    expect(checkManifest('packages/cli', cli, { readme: true })).toEqual([]);
  });

  it('requires a types condition on every export', () => {
    const bad = manifest('core', { exports: { '.': { import: './dist/index.js' } } });
    expect(checkManifest('packages/core', bad, { readme: true }).join('\n')).toContain('exports');
  });
});

describe('checkVersions', () => {
  it('passes when every package and the Python project carry one version', () => {
    const packages = [
      { dir: 'packages/core', manifest: manifest('core') },
      {
        dir: 'packages/cli',
        manifest: manifest('cli', { dependencies: { '@agent-nexus/driftbench-core': 'workspace:*' } }),
      },
    ];
    expect(checkVersions(packages, { python: '0.1.0' })).toEqual({ version: '0.1.0', problems: [] });
  });

  it('names the package out of step, the Python project and a pinned internal dependency', () => {
    const packages = [
      { dir: 'packages/core', manifest: manifest('core') },
      { dir: 'packages/stats', manifest: manifest('stats', { version: '0.0.9' }) },
      {
        dir: 'packages/cli',
        manifest: manifest('cli', { dependencies: { '@agent-nexus/driftbench-core': '^0.0.1' } }),
      },
    ];
    const { problems } = checkVersions(packages, { python: '0.0.0' });
    const text = problems.join('\n');
    expect(text).toContain('@agent-nexus/driftbench-stats');
    expect(text).toContain('python');
    expect(text).toContain('workspace:');
  });

  it('checks the expected version, for example the tag', () => {
    const packages = [{ dir: 'packages/core', manifest: manifest('core') }];
    expect(checkVersions(packages, { expected: '0.2.0' }).problems.join('\n')).toContain('0.2.0');
  });
});

describe('checkChangelog', () => {
  it('finds the version heading', () => {
    expect(checkChangelog('# Changelog\n\n## [0.1.0] - 2026-10-12\n\n### Added\n', '0.1.0')).toEqual([]);
  });

  it('fails when the heading is absent or only mentioned in text', () => {
    expect(checkChangelog('# Changelog\n\n## [0.0.9]\n', '0.1.0')).toHaveLength(1);
    expect(checkChangelog('# Changelog\n\nSee 0.1.0 soon.\n', '0.1.0')).toHaveLength(1);
    expect(
      checkChangelog('# Changelog\n\n### Fixed in 0.1.0\n\n[0.1.0]: https://example.com\n', '0.1.0'),
    ).toHaveLength(1);
  });
});

describe('junkFiles', () => {
  it('flags tests, fixtures, sources, secrets and system files, and keeps the build', () => {
    const files = [
      'package.json',
      'README.md',
      'LICENSE',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/chunk-ab12.js',
      'test/a.test.ts',
      'dist/fixtures/x.json',
      'src/index.ts',
      'dist/a.spec.js',
      '.env',
      'dist/.DS_Store',
      'tsconfig.tsbuildinfo',
    ];
    expect(junkFiles(files)).toEqual([
      'test/a.test.ts',
      'dist/fixtures/x.json',
      'src/index.ts',
      'dist/a.spec.js',
      '.env',
      'dist/.DS_Store',
      'tsconfig.tsbuildinfo',
    ]);
  });
});

describe('packFiles', { timeout: 60_000 }, () => {
  it('lists what npm would pack, with the sizes', () => {
    const root = repo({ packages: { core: manifest('core') } });
    const pack = packFiles(join(root, 'packages', 'core'));
    expect(pack.files).toEqual(
      expect.arrayContaining(['dist/index.js', 'dist/index.d.ts', 'package.json', 'README.md']),
    );
    expect(pack.size).toBeGreaterThan(0);
    expect(pack.unpackedSize).toBeGreaterThan(0);
  });
});

// npm pack takes about two seconds per package on a busy machine.
describe('main', { timeout: 60_000 }, () => {
  it('exits 0 on a clean release and prints a size per package', () => {
    const root = repo({ packages: { core: manifest('core'), stats: manifest('stats') } });
    const result = run([], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('@agent-nexus/driftbench-core');
    expect(result.out).toContain('0.1.0');
  });

  it('exits 1 and names each problem', () => {
    const root = repo({
      packages: {
        core: manifest('core', { files: ['dist', 'test'] }),
        stats: manifest('stats', { version: '0.0.1' }),
      },
      changelog: '# Changelog\n',
      pyproject: '[project]\nname = "driftbench"\nversion = "0.0.0"\n',
    });
    mkdirSync(join(root, 'packages', 'core', 'test'));
    writeFileSync(join(root, 'packages', 'core', 'test', 'a.test.ts'), 'x\n');
    const result = run([], root);
    expect(result.code).toBe(1);
    expect(result.err).toContain('test/a.test.ts');
    expect(result.err).toContain('@agent-nexus/driftbench-stats');
    expect(result.err).toContain('CHANGELOG');
    expect(result.err).toContain('python');
  });

  it('skips private packages and checks --expect against the tag', () => {
    const root = repo({
      packages: {
        core: manifest('core'),
        battery: { name: '@agent-nexus/driftbench-battery', private: true, version: '0.0.0' },
      },
    });
    expect(run([], root).code).toBe(0);
    const tagged = run(['--expect', 'v0.2.0'], root);
    expect(tagged.code).toBe(1);
    expect(tagged.err).toContain('0.2.0');
  });
});
