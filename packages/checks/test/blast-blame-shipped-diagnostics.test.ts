import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_KINDS, ObjectRegistry } from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the release tools, with no types.
import { packFiles } from '../../../tools/release/check.mjs';
import { buildJavaScript } from '../../../tools/test-build';
import { blame } from '../src';

/**
 * Blast radius of PR 451 on what ships: the five diagnostics and both policies are TypeScript data compiled into
 * `dist/`, so the published package carries no object file. Every diagnostic the code names must reach a registry
 * that declares the diagnostic kind, and the pack must hold the build and nothing else of the data.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('the shipped diagnostics', () => {
  it('reach a registry as the five compiled diagnostics, each from the checks package', () => {
    const registry = new ObjectRegistry();
    for (const kind of BUILTIN_KINDS) registry.registerKind(kind);
    blame.registerBlameObjects(registry);
    const diagnostics = registry
      .shipped()
      .filter((entry) => (entry.raw as { kind: string }).kind === 'diagnostic');
    const named = Object.keys(blame.SHIPPED_DIAGNOSTICS).sort();
    expect(named).toHaveLength(5);
    expect(diagnostics.map((entry) => entry.path).sort()).toEqual(
      named.map((key) => `@agent-nexus/driftbench-checks ${key}`),
    );
  });
});

describe('the published checks package', { timeout: 120_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'blast-shipped-diagnostics-'));
  const checks = join(scratch, 'checks');
  beforeAll(() => {
    buildJavaScript(ROOT, scratch, ['checks']);
  }, 120_000);
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('packs the build and no object or YAML file, so no shipped data waits on a folder', () => {
    const pack = packFiles(checks) as { files: string[] };
    expect(pack.files).toContain('dist/index.js');
    expect(pack.files.filter((file) => file.startsWith('objects/') || /\.ya?ml$/.test(file))).toEqual([]);
  });
});
