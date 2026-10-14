import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

it('runs the repository benchmark entry without loading the published CLI', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'benchmarks/cli.ts', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('replay');
  expect(result.stdout).toContain('record');
  expect(result.stdout).toContain('floors');
});
