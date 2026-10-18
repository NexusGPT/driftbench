import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

/** Blast-radius audit (PR 431): describeSpec on a spec of a newer format reports the upgrade error. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/vitest.config.ts', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('blast radius: describeSpec on schema_version 2', () => {
  it('registers one failing test that names SPEC_SCHEMA_VERSION and the upgrade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-vitest-schema-'));
    made.push(dir);
    const output = join(dir, 'report.json');
    await promisify(execFile)(
      join(ROOT, 'node_modules', '.bin', 'vitest'),
      [
        'run',
        'packages/vitest/test/fixtures/blast-verdicts-newer.fixture.ts',
        '--config',
        CONFIG,
        '--reporter=json',
        `--outputFile=${output}`,
      ],
      { cwd: ROOT },
    ).catch(() => undefined); // a failing fixture exits 1; the report says what failed
    const report = JSON.parse(await readFile(output, 'utf8')) as {
      testResults: Array<{
        assertionResults: Array<{ title: string; status: string; failureMessages: string[] }>;
      }>;
    };
    const results = report.testResults.flatMap((file) => file.assertionResults);
    expect(results.map((result) => [result.title, result.status])).toEqual([['is a valid spec', 'failed']]);
    expect(results[0]?.failureMessages[0]).toContain('schema_version SPEC_SCHEMA_VERSION');
    expect(results[0]?.failureMessages[0]).toContain('upgrade driftbench');
    expect(results[0]?.failureMessages[0]).not.toContain('future_key');
  }, 120_000);
});
