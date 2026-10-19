import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../tools/test-setup/temp-folders';
import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));
const STATIC = join(FIXTURE, 'generated/static');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: FIXTURE,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

describe('driftbench estate static', () => {
  it('runs the committed static tests on the fixture: the planted invariant defects fail, the settings pass', async () => {
    const result = await run(['estate', 'static', STATIC, '--estate', FIXTURE, '--json']);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    const json = JSON.parse(result.out) as {
      passed: number;
      failed: number;
      results: Array<{ id: string; pass: boolean }>;
    };
    const by = Object.fromEntries(json.results.map((entry) => [entry.id, entry.pass]));
    expect(json.passed + json.failed).toBe(8);
    expect(by['estate.setting.setting.settings.setting-model-is-opus']).toBe(true);
    expect(by['estate.invariant.invariant.standing.the-standing-instructions-stay-under-40000']).toBe(true);
    expect(by['estate.invariant.invariant.registry.the-check-registry-lists-every-guard']).toBe(false);
  });

  it('turns a setting test red on a copy whose settings changed', async () => {
    const root = await tempFolder('driftbench-estate-static-');
    await cp(join(FIXTURE, 'CLAUDE.md'), join(root, 'CLAUDE.md'));
    await cp(join(FIXTURE, '.claude'), join(root, '.claude'), { recursive: true });
    const settings = join(root, '.claude/settings.json');
    await writeFile(
      settings,
      (await readFile(settings, 'utf8')).replace('"model": "opus"', '"model": "haiku"'),
    );
    const test = join(STATIC, 'setting/estate.setting.setting.settings.setting-model-is-opus.json');
    const original = await run(['estate', 'static', test, '--estate', FIXTURE]);
    expect(original.code).toBe(0);
    expect(original.out).toContain('1 of 1 static tests pass.');
    const mutant = await run(['estate', 'static', test, '--estate', root]);
    expect(mutant.code).toBe(1);
    expect(mutant.out).toContain('model is haiku, the map says opus');
  });

  it('exits 2 with no estate, no test or a file that is no static test', async () => {
    expect((await run(['estate', 'static', STATIC])).code).toBe(2);
    expect((await run(['estate', 'static', join(FIXTURE, 'nowhere'), '--estate', FIXTURE])).code).toBe(2);
    expect(
      (
        await run([
          'estate',
          'static',
          join(FIXTURE, 'generated/estate-generate-report.json'),
          '--estate',
          FIXTURE,
        ])
      ).code,
    ).toBe(2);
  });
});
