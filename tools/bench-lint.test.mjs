import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lintBenchmarks, lintBenchSource } from './bench-lint.mjs';

const roots = [];
const script = fileURLToPath(new URL('./bench-lint.mjs', import.meta.url));
const allowed =
  "import { buildPrompt, type JudgeRequest, PROMPT_FINGERPRINT } from '@agent-nexus/driftbench-judges';";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-bench-lint-'));
  roots.push(root);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return root;
}

describe('bench public API boundary', () => {
  it('allows only named command plumbing APIs in the repository entry', () => {
    const source = [
      "import { loadSpecs } from '@agent-nexus/driftbench-core';",
      "import { openMemoryStore, openStore, readTree } from '@agent-nexus/driftbench-store';",
      "import { findRoot } from '@agent-nexus/driftbench-validators';",
      "import { Command, CommanderError } from 'commander';",
    ].join('\n');
    expect(lintBenchSource(source, 'benchmarks/cli.ts')).toEqual([]);
    expect(lintBenchSource(source, 'benchmarks/run.ts').length).toBeGreaterThan(0);
    expect(
      lintBenchSource(source.replace('loadSpecs', 'privateHelper'), 'benchmarks/cli.ts').length,
    ).toBeGreaterThan(0);
    expect(
      lintBenchSource("import * as core from '@agent-nexus/driftbench-core';", 'benchmarks/cli.ts').length,
    ).toBeGreaterThan(0);
  });

  it('accepts the public judge API, metadata, statistics, builtins and local harness modules', () => {
    const source = [
      allowed,
      "import type { JudgeClient, Cassette } from '@agent-nexus/driftbench-judges';",
      "import { requestKey, recordingClient, playerClient } from '@agent-nexus/driftbench-judges';",
      "import { wilson, mcnemarExact } from '@agent-nexus/driftbench-stats';",
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'path';",
      "import { slices } from './slices';",
      "export { slices } from './slices';",
      "type Request = import('@agent-nexus/driftbench-judges').JudgeRequest;",
      '// require("private") and import("private") here are inert documentation.',
      'const example = "import privateCode from \'../../packages/judges/src/prompt\'";',
    ].join('\n');
    expect(lintBenchSource(source, 'benchmarks/run.ts')).toEqual([]);
  });

  it.each([
    ['private source', "import { buildPrompt } from '../packages/judges/src/prompt';"],
    ['deep package import', allowed.replace("driftbench-judges'", "driftbench-judges/src/prompt'")],
    ['different package', allowed.replace('driftbench-judges', 'driftbench-core')],
    [
      'renamed private import',
      "import { SYSTEM_PROMPT as buildPrompt } from '@agent-nexus/driftbench-judges';",
    ],
    ['namespace bypass', "import * as judges from '@agent-nexus/driftbench-judges';"],
    ['default bypass', "import judges from '@agent-nexus/driftbench-judges';"],
    ['export bypass', "export * from '../packages/judges/src/index';"],
    ['public export bypass', "export * from '@agent-nexus/driftbench-judges';"],
    ['test helper bypass', "import { judges } from './test/helpers';"],
    ['preparation bypass', "import { judges } from './scripts/prepare';"],
    ['require', "const judges = require('../packages/judges/src/index');"],
    ['aliased require', "const load = require; const judges = load('../packages/judges/src/index');"],
    ['module require', "const judges = module.require('../packages/judges/src/index');"],
    ['computed require', "const judges = module['require']('../packages/judges/src/index');"],
    ['import equals', "import judges = require('../packages/judges/src/index');"],
    ['dynamic import', "const judges = await import('../packages/judges/src/index');"],
    ['computed import', "const judges = await import(folder + '/prompt');"],
    ['loader factory', "import { createRequire as load } from 'node:module';"],
    ['builtin loader', "const loader = process.getBuiltinModule('module');"],
    ['type import', "type Prompt = import('../packages/judges/src/prompt').Prompt;"],
    ['unknown builtin', "import { x } from 'node:imaginary';"],
  ])('rejects %s with a source location and actionable diagnosis', (_name, source) => {
    const problems = lintBenchSource(source, 'benchmarks/run.ts');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(/benchmarks\/run\.ts:\d+:\d+: /);
    expect(problems.join('\n')).toMatch(/public|static imports|benchmark/);
  });

  it('scans nested production modules while excluding test and preparation scripts', () => {
    const root = fixture({
      'benchmarks/run.ts': allowed,
      'benchmarks/support/scorer.ts': "import { x } from '../../packages/judges/src/prompt';",
      'benchmarks/test/fake.test.ts': "import { it } from 'vitest';",
      'benchmarks/scripts/prepare.ts': "import { x } from '../../research/private';",
    });
    const problems = lintBenchmarks(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('benchmarks/support/scorer.ts');
  });

  it('turns a passing fixture red when its public import is replaced by a private source import', () => {
    const root = fixture({ 'benchmarks/run.ts': allowed });
    const run = () => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    expect(run().status).toBe(0);
    writeFileSync(
      join(root, 'benchmarks/run.ts'),
      allowed.replace('@agent-nexus/driftbench-judges', '../packages/judges/src/index'),
    );
    const broken = run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('benchmarks/run.ts:1:');
    expect(broken.stderr).toContain('public');
  });

  it('cannot move a forbidden dependency into a local JavaScript helper', () => {
    const root = fixture({
      'benchmarks/run.ts': "import { judges } from './helper.js';",
      'benchmarks/helper.js': "export const judges = require('../packages/judges/src/index');",
    });
    expect(lintBenchmarks(root).join('\n')).toContain('benchmarks/helper.js:1:');
  });

  it('fails closed when the harness is absent or has a parse error', () => {
    expect(lintBenchmarks(fixture({})).join('\n')).toContain('benchmarks/run.ts');
    expect(lintBenchSource('import { broken', 'benchmarks/run.ts').join('\n')).toContain('syntax');
  });
});
