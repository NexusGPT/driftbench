import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNNER = join(import.meta.dirname, 'run-shard.mjs');

/** Runs run-shard.mjs with a stand-in `pnpm` that records its arguments, and returns them. */
function runShard(planned, index, { mutation, exit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'run-shard-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const record = join(dir, 'args.txt');
    const dist = join(dir, 'packages/stats/dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.js'), 'export const mde = () => 1;');
    writeFileSync(
      join(bin, 'pnpm'),
      `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(record)}, process.argv.slice(2).join('\\n'));
const file = ${JSON.stringify(join(dist, 'index.js'))};
switch (${JSON.stringify(mutation)}) {
  case 'rewrite':
    fs.writeFileSync(file, fs.readFileSync(file));
    fs.utimesSync(file, 1, 1);
    break;
  case 'restore-time': {
    const before = fs.statSync(file);
    fs.writeFileSync(file, fs.readFileSync(file));
    fs.utimesSync(file, before.atime, before.mtime);
    break;
  }
  case 'create': fs.writeFileSync(file + '.map', 'new'); break;
  case 'delete': fs.unlinkSync(file); break;
  case 'transient': fs.writeFileSync(file + '.map', 'new'); fs.unlinkSync(file + '.map'); break;
}
process.exit(${exit});
`,
    );
    chmodSync(join(bin, 'pnpm'), 0o755);
    const plan = join(dir, 'plan.json');
    writeFileSync(
      plan,
      JSON.stringify({ count: planned.length, shards: planned.map((files) => ({ load: 0, files })) }),
    );
    const result = spawnSync(process.execPath, [RUNNER, '--plan', plan, '--index', String(index)], {
      cwd: dir,
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
  it.each(['rewrite', 'restore-time', 'create', 'delete', 'transient'])(
    'rejects shared dist writes even when vitest passes (%s)',
    (mutation) => {
      const result = runShard(plan, 1, { mutation });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('tests modified shared dist');
      expect(result.stderr).toContain('packages/stats/dist');
    },
  );
  it('preserves a failing vitest status, with or without a shared dist write', () => {
    expect(runShard(plan, 1, { exit: 7 }).status).toBe(7);
    const result = runShard(plan, 1, { mutation: 'rewrite', exit: 7 });
    expect(result.status).toBe(7);
    expect(result.stderr).toContain('tests modified shared dist');
  });
  it('refuses an index outside the plan and a shard that holds no file', () => {
    expect(runShard(plan, 0).status).toBe(2);
    expect(runShard(plan, 4).status).toBe(2);
    expect(runShard([['x.test.ts'], []], 2).status).toBe(2);
  });
});
