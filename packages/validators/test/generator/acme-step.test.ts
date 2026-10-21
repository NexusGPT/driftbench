import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cli, stepFailed } from '../../src/ladders/generator/acme';

/**
 * The Acme items run `generate` and `gate` as child processes and read the report each one writes. A child
 * ends with an exit code or, when a signal ends it, with none. The run must call a step failed in the second
 * case too, or it reads a report that was never written and every item throws ENOENT.
 */
describe('the Acme run reads the end of a step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-acme-step-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const entry = (name: string, body: string): string => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  it('calls a step ended by a signal failed, and names the signal', async () => {
    const run = await cli([], entry('killed.mjs', "process.kill(process.pid, 'SIGKILL');\n"));
    expect(run.code).toBe(-1);
    expect(run.out).toContain('SIGKILL');
    expect(stepFailed(run)).toBe(true);
  });

  it.each([
    [0, false],
    [1, false],
    [2, true],
    [3, true],
  ])('exit %i is failed: %s', async (code, failed) => {
    const run = await cli([], entry(`exit-${code}.mjs`, `process.exit(${code});\n`));
    expect(run.code).toBe(code);
    expect(stepFailed(run)).toBe(failed);
  });

  it('keeps the output of a step that exits 1', async () => {
    const run = await cli([], entry('says.mjs', "console.log('3 incomplete');\nprocess.exit(1);\n"));
    expect(run.out).toContain('3 incomplete');
    expect(stepFailed(run)).toBe(false);
  });
});
