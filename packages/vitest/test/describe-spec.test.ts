import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { blockName } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/vitest.config.ts', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

type JsonReport = {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ fullName: string; status: string; failureMessages: string[] }>;
  }>;
};

/** Runs one fixture file in a child vitest and reads its JSON report. */
async function runFixture(name: string): Promise<JsonReport['testResults'][number]['assertionResults']> {
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
  const report = JSON.parse(await readFile(output, 'utf8')) as JsonReport;
  return report.testResults.flatMap((file) => file.assertionResults);
}

describe('describeSpec', () => {
  it('registers one test per block, and they pass on an agent that keeps the spec', async () => {
    const results = await runFixture('acme.fixture.ts');
    expect(results.map((result) => [result.fullName, result.status])).toEqual([
      ["acme-plan-upgrade block 0: Hi, I'm already an Acme customer and I keep running out o...", 'passed'],
      ["acme-plan-upgrade block 1: It's sam.rivera@example.com", 'passed'],
      ['acme-plan-upgrade block 2: The unlimited one, please.', 'passed'],
      ['acme-plan-upgrade block 3: Confirm', 'passed'],
      ["acme-plan-upgrade block 4: No, that's all. Thanks!", 'passed'],
      ['acme-plan-upgrade end state', 'passed'],
    ]);
  }, 120_000);

  it('fails exactly the blocks that fail, each with its evidence', async () => {
    const results = await runFixture('broken.fixture.ts');
    expect(results.map((result) => result.status)).toEqual([
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'passed',
    ]);
    const [message] = results[1]?.failureMessages ?? [];
    expect(message).toContain('block 1 failed');
    expect(message).toContain('tools.catalog.search.count');
    expect(message).toContain('catalog.search called 0 times, expected exactly 1');
  }, 120_000);

  it('names a block by its id when it has one, else by its stimulus, cut to 60 characters', () => {
    expect(blockName(2, { id: 'loose-yes', when: { user: 'ok perfect' } })).toBe(
      'block 2 (loose-yes): ok perfect',
    );
    expect(blockName(0, { when: { burst: ['hello?', 'are you there?'] } })).toBe(
      'block 0: hello? / are you there?',
    );
    expect(blockName(1, { when: { user: 'x'.repeat(80) } })).toBe(`block 1: ${'x'.repeat(57)}...`);
  });
});
