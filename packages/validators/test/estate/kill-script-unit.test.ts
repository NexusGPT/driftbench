import { cpSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bench from '../../src/ladders/estate/bank/bench';
import { FIXTURE, fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import { type Cell, judgeScript } from '../../src/ladders/estate/bank/kill';

vi.mock('../../src/ladders/estate/bank/bench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/bank/bench')>();
  return { ...actual, cli: vi.fn(actual.cli) };
});

const folders: string[] = [];
afterEach(async () => {
  vi.mocked(bench.cli).mockReset();
  while (folders.length) await rm(folders.pop() as string, { recursive: true, force: true });
});

async function setup() {
  const actual = await vi.importActual<typeof bench>('../../src/ladders/estate/bank/bench');
  vi.mocked(bench.cli).mockImplementation(actual.cli);
  const suite = await fixtureSuite();
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('the fixture map does not load');
  const scripts = map.map.atoms
    .filter((atom) => atom.kind === 'script')
    .map((atom) => atom.id)
    .sort();
  const work = await mkdtemp(join(tmpdir(), 'kill-script-'));
  folders.push(work);
  const cell = (index: number): Cell => ({ kind: 'script', index, op: 'delete', tier: 3 });
  return { suite, scripts, work, actual, cell, map: join(FIXTURE, 'approved.yaml') };
}

describe('kill.fake script cells are judged by the script_fixture unit test', { timeout: 600_000 }, () => {
  it('passes both scripts of the fixture: the unit test is green on the original, red once the script is deleted', async () => {
    const { suite, scripts, work, cell, map } = await setup();
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const index of [0, 1]) {
      const result = await judgeScript(cell(index), scripts[index] as string, suite.specs, map, work);
      expect(result, scripts[index]).toMatchObject({ pass: true });
    }
  });

  it('fails when the mutation leaves the script in place: a fake that ignores the deletion is not a kill', async () => {
    const { suite, scripts, work, actual, cell, map } = await setup();
    vi.mocked(bench.cli).mockImplementation((args, cwd) => {
      if (args[0] === 'estate' && args[1] === 'mutate') {
        // The mutation writes an untouched copy of the estate, as a tool that ignores the deletion would.
        cpSync(FIXTURE, args[args.indexOf('--to') + 1] as string, { recursive: true });
        return { code: 0, out: '' };
      }
      return actual.cli(args, cwd);
    });
    const result = await judgeScript(cell(0), scripts[0] as string, suite.specs, map, work);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/stay green|mutate refused/);
  });

  it('fails when no script_fixture unit test names the script', async () => {
    const { suite, scripts, work, cell, map } = await setup();
    const without = suite.specs.filter((spec) => spec.mode !== 'native-unit');
    const result = await judgeScript(cell(0), scripts[0] as string, without, map, work);
    expect(result).toMatchObject({
      pass: false,
      detail: expect.stringContaining('no script_fixture unit test'),
    });
  });
});
