import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNNER = join(import.meta.dirname, 'run-shard.mjs');

/** Runs run-shard.mjs with a stand-in `pnpm` that records its arguments, and returns them. */
function runShard(planned, index) {
  const dir = mkdtempSync(join(tmpdir(), 'run-shard-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const record = join(dir, 'args.txt');
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`);
    chmodSync(join(bin, 'pnpm'), 0o755);
    const plan = join(dir, 'plan.json');
    writeFileSync(
      plan,
      JSON.stringify({ count: planned.length, shards: planned.map((files) => ({ load: 0, files })) }),
    );
    const result = spawnSync(process.execPath, [RUNNER, '--plan', plan, '--index', String(index)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    const args = result.status === 0 ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : [];
    return { status: result.status, args, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('run-shard', () => {
  const plan = [
    ['a/one.test.ts', 'a/two.test.ts', 'b/three.test.mjs'],
    ['c/four.test.ts'],
    ['d/five.test.mjs', 'd/six.test.ts'],
  ];
  it('hands vitest exactly the files its shard holds, in order, not one fewer and not one more', () => {
    for (const [at, files] of plan.entries()) {
      const { status, args } = runShard(plan, at + 1);
      expect(status).toBe(0);
      // The whole argument list, so that no extra flag (--shard, --bail, -t, --exclude, a filter) can ride along.
      expect(args).toEqual(['exec', 'vitest', 'run', '--maxWorkers=2', ...files]);
    }
  });
  it('refuses an index outside the plan and a shard that holds no file', () => {
    expect(runShard(plan, 0).status).toBe(2);
    expect(runShard(plan, 4).status).toBe(2);
    expect(runShard([['x.test.ts'], []], 2).status).toBe(2);
  });
});
