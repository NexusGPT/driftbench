import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

// The entry runs in a fresh node process under tsx, which transforms the whole import graph (core, judges, store,
// validators) on its first run, because its cache is empty: 4.99 s cold against 0.81 s warm on a loaded machine
// (load average 72). A CI runner starts cold, and a default 5 s test timeout fails on it under load.
const COLD_START_MS = 60_000;

// vitest's test timeout cannot interrupt a synchronous spawn, so the spawn carries its own limit and kills the child.
const run = (argv: string[], timeout: number) =>
  spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGKILL' });

it(
  'runs the repository benchmark entry without loading the published CLI',
  () => {
    const result = run(['--import', 'tsx', 'benchmarks/cli.ts', '--help'], COLD_START_MS);
    expect(result.error, String(result.error)).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('replay');
    expect(result.stdout).toContain('record');
    expect(result.stdout).toContain('floors');
  },
  COLD_START_MS + 15_000,
);

it('fails within its limit when the entry hangs', () => {
  const start = Date.now();
  const result = run(['-e', 'setInterval(() => {}, 1000)'], 500);
  expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
  expect(result.signal).toBe('SIGKILL');
  expect(Date.now() - start).toBeLessThan(5_000);
});
