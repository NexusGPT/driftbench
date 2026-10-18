import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { SCOPE_PREFIX, sweepDeadScopes } from '../src/scope-folder';

/** Fictional data only: an agent that never answers, so the campaign is mid-run when it is killed. */
const AGENT = fileURLToPath(new URL('./fixtures/hang-agent.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const COMMAND = JSON.stringify([process.execPath, AGENT]);
const SPEC = `id: hang
blocks:
  - id: greet
    user: hello
    expect:
      must: ['echo: hello']
`;
const SLOW = 120_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function scopes(temp: string): Promise<string[]> {
  return (await readdir(temp)).filter((name) => name.startsWith(SCOPE_PREFIX));
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, limitMs: number): Promise<T> {
  const end = Date.now() + limitMs;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

describe('a campaign killed mid-run', () => {
  it.each(['SIGKILL', 'SIGINT', 'SIGTERM'] as const)(
    'leaves no sandbox folder behind after %s',
    async (signal) => {
      const dir = await mkdtemp(join(tmpdir(), 'driftbench-killed-'));
      made.push(dir);
      const temp = join(dir, 'tmp');
      await mkdir(temp);
      await writeFile(join(dir, 'hang.yaml'), SPEC);
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'packages/cli/src/bin.ts'),
          'campaign',
          'run',
          join(dir, 'hang.yaml'),
          '--target',
          'process:hang',
          '--process-command',
          COMMAND,
          '--store',
          join(dir, 'runs.db'),
        ],
        { cwd: ROOT, env: { ...process.env, TMPDIR: temp }, stdio: 'ignore' },
      );
      const pid = child.pid;
      expect(pid).toBeDefined();
      const open = await until(
        () => scopes(temp),
        (found) => found.length > 0,
        60_000,
      );
      expect(open).toHaveLength(1);
      process.kill(pid as number, signal);
      const left = await until(
        () => scopes(temp),
        (found) => found.length === 0,
        20_000,
      );
      expect(left).toEqual([]);
    },
    SLOW,
  );
});

describe('sweepDeadScopes', () => {
  it('removes the folders of a process that is gone and keeps the ones of a live process', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'driftbench-sweep-'));
    made.push(temp);
    const gone = join(temp, `${SCOPE_PREFIX}2147483646-abc123`);
    const live = join(temp, `${SCOPE_PREFIX}${process.pid}-abc123`);
    const other = join(temp, 'driftbench-other-1-abc123');
    for (const folder of [gone, live, other]) await mkdir(join(folder, 'driftbench-x'), { recursive: true });
    await sweepDeadScopes(temp);
    expect(await readdir(temp)).toEqual([
      'driftbench-other-1-abc123',
      `${SCOPE_PREFIX}${process.pid}-abc123`,
    ]);
  });
});
