import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const MAP = fileURLToPath(new URL('../../../examples/estates/fixture/approved.yaml', import.meta.url));
const SQLITE = 'SQLite is an experimental feature and might change at any time';

function lint(warning: string) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
    process.argv = ['node', 'driftbench', 'estate', 'lint', ${JSON.stringify(MAP)}];
    await import(${JSON.stringify(BIN)});
    ${warning}
  `,
    ],
    { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 30_000 },
  );
}

describe('SQLite warning at the CLI entry', () => {
  it.each([
    `process.emitWarning(${JSON.stringify(SQLITE)}, 'ExperimentalWarning');`,
    `process.emitWarning(${JSON.stringify(SQLITE)}, { type: 'ExperimentalWarning' });`,
    `const warning = new Error(${JSON.stringify(SQLITE)}); warning.name = 'ExperimentalWarning'; process.emitWarning(warning);`,
  ])(
    'keeps lint stderr empty for the exact SQLite warning: %s',
    (warning) => {
      const run = lint(warning);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain('ORPHAN');
      expect(run.stderr).toBe('');
    },
    60_000,
  );
  it.each([
    [
      `process.emitWarning('Another experimental feature', 'ExperimentalWarning');`,
      'ExperimentalWarning: Another experimental feature',
    ],
    [`process.emitWarning(${JSON.stringify(SQLITE)}, 'Warning');`, `Warning: ${SQLITE}`],
    [
      `process.emitWarning('Check this deprecation', { type: 'DeprecationWarning', code: 'DEP_TEST', detail: 'Keep this detail' });`,
      '[DEP_TEST] DeprecationWarning: Check this deprecation',
    ],
  ])(
    'preserves other warnings: %s',
    (warning, expected) => {
      const run = lint(warning);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(expected);
      if (warning.includes('Keep this detail')) expect(run.stderr).toContain('Keep this detail');
    },
    60_000,
  );
});
