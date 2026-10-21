import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALWAYS, affectedFiles, shardOf, vitestArgs } from './affected-shard.mjs';

const TOOL = join(import.meta.dirname, 'affected-shard.mjs');

/**
 * Runs affected-shard.mjs with a stand-in `pnpm`: `exec vitest list ...` prints `listed` and records its arguments,
 * `exec vitest run ...` records its arguments. Returns what the tool did.
 */
function runTool(listed, args, { listStatus = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'affected-shard-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(dir, 'list.txt'), listed.join('\n'));
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/bin/sh\nif [ "$3" = list ]; then printf '%s\\n' "$@" > '${dir}/list-args.txt'; cat '${dir}/list.txt'; exit ${listStatus}; fi\nprintf '%s\\n' "$@" > '${dir}/run-args.txt'\n`,
    );
    chmodSync(join(bin, 'pnpm'), 0o755);
    const durations = join(dir, 'durations.json');
    writeFileSync(
      durations,
      JSON.stringify({ 'big.test.ts': 500, 'mid.test.ts': 300, 'small.test.ts': 100 }),
    );
    const result = spawnSync(process.execPath, [TOOL, ...args, '--durations', durations], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    const read = (name) => {
      try {
        return readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean);
      } catch {
        return undefined;
      }
    };
    return {
      status: result.status,
      stderr: result.stderr,
      list: read('list-args.txt'),
      run: read('run-args.txt'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('affected-shard', () => {
  const listed = ['big.test.ts', 'mid.test.ts', 'small.test.ts', 'zed.test.mjs', 'not-a-test.ts', ''];

  it('adds the always-run files to the listed ones, once each, and drops what is no test file', () => {
    const files = affectedFiles([...listed, ...ALWAYS, ...ALWAYS]);
    expect(files).toEqual(['big.test.ts', 'mid.test.ts', 'small.test.ts', 'zed.test.mjs', ...ALWAYS].sort());
  });

  it('places every affected file in exactly one shard, for every shard count', () => {
    const files = affectedFiles(listed);
    const durations = { 'big.test.ts': 500, 'mid.test.ts': 300, 'small.test.ts': 100 };
    for (const count of [1, 2, 3, 5, 8, 20]) {
      const placed = Array.from({ length: count }, (_, at) =>
        shardOf(files, durations, count, at + 1),
      ).flat();
      expect([...placed].sort()).toEqual(files);
    }
  });

  it('refuses a shard index outside 1 to count', () => {
    for (const index of [0, 4, 1.5, Number.NaN]) expect(() => shardOf(['a.test.ts'], {}, 3, index)).toThrow();
  });

  it('lists with --changed <base> and nothing else, and hands vitest exactly the files its shard holds', () => {
    const count = 3;
    const seen = [];
    for (const index of [1, 2, 3]) {
      const { status, list, run } = runTool(listed, [
        '--base',
        'origin/release/next',
        '--count',
        String(count),
        '--index',
        String(index),
      ]);
      expect(status).toBe(0);
      expect(list).toEqual(['exec', 'vitest', 'list', '--filesOnly', '--changed', 'origin/release/next']);
      if (run !== undefined) {
        expect(run.slice(0, 4)).toEqual(['exec', 'vitest', 'run', '--maxWorkers=2']);
        seen.push(...run.slice(4));
      }
    }
    // the union of the shards is the affected set, with no file twice
    expect([...seen].sort()).toEqual(affectedFiles(listed));
    expect(vitestArgs(['x.test.ts'])).toEqual(['exec', 'vitest', 'run', '--maxWorkers=2', 'x.test.ts']);
  });

  it('passes with an empty shard, and fails when the listing fails or the arguments are wrong', () => {
    const empty = runTool([], ['--base', 'origin/main', '--count', '8', '--index', '8']);
    expect(empty.status).toBe(0);
    expect(empty.run).toBeUndefined();
    expect(
      runTool(listed, ['--base', 'origin/main', '--count', '3', '--index', '1'], { listStatus: 1 }).status,
    ).toBe(1);
    expect(runTool(listed, ['--base', 'origin/main', '--count', '3', '--index', '4']).status).toBe(2);
    expect(runTool(listed, ['--count', '3', '--index', '1']).status).toBe(2);
  });
});
