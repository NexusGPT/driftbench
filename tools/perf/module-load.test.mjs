import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT, runNode, writeProbe } from '../perf-baseline.mjs';

/**
 * Pins what a process loads, by count and never by time. Each case starts a fresh Node.js process from source
 * under the probe of tools/perf-baseline.mjs and reads the modules it loaded, per dependency.
 */

/** The dependencies a process loaded, as { name: module count }. */
function loaded(args) {
  const run = runNode(['--import', 'tsx', ...args], { probe: 'full' });
  expect(run.report, run.stderr).toBeDefined();
  return {
    status: run.status,
    stdout: run.stdout,
    packages: run.report.modules_by_package,
    workspace: run.report.modules_by_workspace,
  };
}

const importOnly = (entry) => [
  '--input-type=module',
  '--eval',
  'await import(process.argv[1]);',
  join(ROOT, entry),
];

beforeAll(writeProbe);

describe('what loads at start', () => {
  it('loads no spreadsheet parser with the artifacts package', () => {
    const { status, packages } = loaded(importOnly('packages/artifacts/src/index.ts'));
    expect(status).toBe(0);
    expect(packages.exceljs).toBeUndefined();
    // exceljs is the only user of these: none of its tree may load either.
    for (const name of ['unzipper', 'es-abstract', 'bluebird', 'archiver', '@fast-csv/parse']) {
      expect(packages[name], name).toBeUndefined();
    }
  }, 120_000);

  it('loads no PDF parser and no native canvas library with the artifacts package', () => {
    const { status, packages } = loaded(importOnly('packages/artifacts/src/index.ts'));
    expect(status).toBe(0);
    for (const name of ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas']) {
      expect(packages[name], name).toBeUndefined();
    }
  }, 120_000);

  it('loads no document or archive parser with the artifacts package', () => {
    const { status, packages } = loaded(importOnly('packages/artifacts/src/index.ts'));
    expect(status).toBe(0);
    for (const name of ['jszip', 'mammoth', 'pako', 'xmlbuilder']) {
      expect(packages[name], name).toBeUndefined();
    }
  }, 120_000);

  it('loads no file parser to print the help of the CLI', () => {
    const { status, stdout, packages } = loaded([join(ROOT, 'packages/cli/src/bin.ts'), '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage: driftbench');
    for (const name of ['exceljs', 'pdf-parse', '@napi-rs/canvas', 'jszip', 'mammoth']) {
      expect(packages[name], name).toBeUndefined();
    }
  }, 120_000);

  it('loads no language detector with the checks package', () => {
    const { status, packages } = loaded(importOnly('packages/checks/src/index.ts'));
    expect(status).toBe(0);
    for (const name of ['franc-min', 'trigram-utils', 'n-gram']) expect(packages[name], name).toBeUndefined();
  }, 120_000);

  it('loads no command module and no other package to print the help of the CLI', () => {
    const { status, packages, workspace } = loaded([join(ROOT, 'packages/cli/src/bin.ts'), '--help']);
    expect(status).toBe(0);
    expect(Object.keys(workspace)).toEqual(['packages/cli']);
    for (const name of ['zod', 'yaml', 'smol-toml', 'franc-min'])
      expect(packages[name], name).toBeUndefined();
  }, 120_000);

  it('loads the validators package for validate, and for no other command', () => {
    const help = loaded([join(ROOT, 'packages/cli/src/bin.ts'), '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('validate [options] <component> [level]');
    expect(help.workspace['packages/validators']).toBeUndefined();
    expect(help.workspace['packages/cli']).toBeGreaterThan(0);

    // An unknown component is refused by the command itself, after it loaded the ladders: exit 64.
    const validate = loaded([join(ROOT, 'packages/cli/src/bin.ts'), 'validate', 'no-such-component']);
    expect(validate.status).toBe(64);
    expect(validate.workspace['packages/validators']).toBeGreaterThan(0);
  }, 240_000);
});
