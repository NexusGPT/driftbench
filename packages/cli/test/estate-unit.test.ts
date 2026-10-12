import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const UNIT = join(FIXTURE, 'generated/unit');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

describe('driftbench estate unit on the Northwind suite', () => {
  it('refuses unrecorded guard tests, records them on the original, passes there, and fails on a mutant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'estate-unit-'));
    const tests = join(dir, 'unit');
    await cp(UNIT, tests, { recursive: true });

    const unrecorded = await run(['estate', 'unit', tests, '--estate', FIXTURE]);
    expect(unrecorded.code).toBe(2);
    expect(unrecorded.out).toContain('0 of 26 unit tests pass, 0 fail, 2 inert, 24 unrecorded');

    const recorded = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--record']);
    expect(recorded.err).toBe('');
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain('Recorded 26 unit tests');
    const file = join(
      tests,
      'guard_positive/unit.guard_positive.guard.settings.pretooluse-bash-guard-block-force-push.json',
    );
    const test = JSON.parse(await readFile(file, 'utf8'));
    expect(test.cases[0].expected).toMatchObject({ decision: 'deny', exitCode: 2 });
    expect(test.recordedOn).toBe(test.mapHash);

    const again = await run(['estate', 'unit', tests, '--estate', FIXTURE, '--json']);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.out).counts).toEqual({ pass: 18, fail: 0, inert: 8, unrecorded: 0 });

    const mutant = join(dir, 'mutant');
    const atom = 'guard.settings.pretooluse-bash-guard-block-force-push';
    expect(
      (
        await run([
          'estate',
          'mutate',
          join(FIXTURE, 'approved.yaml'),
          '--atom',
          atom,
          '--delete',
          '--to',
          mutant,
        ])
      ).code,
    ).toBe(0);
    const killed = await run(['estate', 'unit', tests, '--estate', mutant, '--json']);
    expect(killed.code).toBe(1);
    const failed = JSON.parse(killed.out).results.filter(
      (result: { status: string }) => result.status === 'fail',
    );
    expect(failed.map((result: { id: string }) => result.id).sort()).toEqual([
      `unit.guard_hostile.${atom}`,
      `unit.guard_negative.${atom}`,
      `unit.guard_positive.${atom}`,
      `unit.guard_speed.${atom}`,
    ]);
  }, 120_000);

  it('exits 2 on a missing estate, a missing path and a file that is no unit test', async () => {
    expect((await run(['estate', 'unit', UNIT])).code).toBe(2);
    expect((await run(['estate', 'unit', join(UNIT, 'nothing'), '--estate', FIXTURE])).code).toBe(2);
    expect(
      (await run(['estate', 'unit', join(FIXTURE, 'plan.summary.json'), '--estate', FIXTURE])).code,
    ).toBe(2);
  });
});
