import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

// The vitest plugin and given.origin (PR 424): a spec with an origin runs with the origin handed to the
// agent, and an origin with no prefix is one failing test that names the error code.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/vitest.config.ts', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

type Result = { fullName: string; status: string; failureMessages: string[] };

async function runFixture(name: string): Promise<Result[]> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-vitest-'));
  made.push(dir);
  const output = join(dir, 'report.json');
  await promisify(execFile)(
    join(ROOT, 'node_modules', '.bin', 'vitest'),
    [
      'run',
      `packages/vitest/test/fixtures/${name}`,
      '--config',
      CONFIG,
      '--reporter=json',
      `--outputFile=${output}`,
    ],
    { cwd: ROOT },
  ).catch(() => undefined); // a failing fixture exits 1; the report says what failed
  const report = JSON.parse(await readFile(output, 'utf8')) as {
    testResults: { assertionResults: Result[] }[];
  };
  return report.testResults.flatMap((file) => file.assertionResults);
}

describe('describeSpec with given.origin', () => {
  it('runs a spec with an origin, its session opened with that origin, and fails an origin without a prefix by its code', async () => {
    const results = await runFixture('blast-wire3-origin.fixture.ts');
    expect(results.map((result) => [result.fullName, result.status])).toEqual([
      ['blast-wire3-origin block 0: What is my reference?', 'passed'],
      ['blast-wire3-origin block 1: And when will they call?', 'passed'],
      [expect.stringContaining('blast-wire3-origin-alone.yaml is a valid spec'), 'failed'],
    ]);
    const [message] = results[2]?.failureMessages ?? [];
    expect(message).toContain('blocks.0.given.origin GIVEN_ORIGIN_WITHOUT_PREFIX');
  }, 120_000);
});
