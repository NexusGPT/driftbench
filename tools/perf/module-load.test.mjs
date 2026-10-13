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
  return { status: run.status, stdout: run.stdout, packages: run.report.modules_by_package };
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
});
